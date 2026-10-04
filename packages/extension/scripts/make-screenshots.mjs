#!/usr/bin/env node
/**
 * Render the store screenshots from the real extension.
 *
 *   node scripts/make-screenshots.mjs
 *
 * Chrome Web Store will not let a listing go live without at least one
 * screenshot, and it accepts only 1280x800 or 640x400. The popup is 360px
 * wide, so a raw capture is both the wrong aspect ratio and mostly empty —
 * each shot is therefore the genuine popup capture composited onto a 1280x800
 * branded canvas with a caption.
 *
 * The captures come from the extension actually running: Chromium is launched
 * with the packaged `release/unpacked-chrome` tree loaded, so what is
 * photographed is the shipped build, not a mock of it.
 *
 * Output goes to the versioned `store-assets/` — the images the stores are
 * actually serving belong in git, not in gitignored build output.
 *
 * PLAYWRIGHT_CORE and CHROMIUM_BIN can override the discovered paths. On this
 * dev box Chromium needs a staged library and font prefix; those are applied
 * automatically when present so the script stays a plain `node scripts/...`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const unpacked = resolve(pkgRoot, 'release/unpacked-chrome');
const outDir = resolve(pkgRoot, 'store-assets');

// The dev box has no browser package; Chromium's runtime libs and fonts are
// staged under ~/.local/share/chrome-deps. Setting these here rather than as a
// shell prefix keeps the invocation a plain `node scripts/make-screenshots.mjs`.
const deps = resolve(homedir(), '.local/share/chrome-deps');
if (existsSync(deps)) {
  process.env.LD_LIBRARY_PATH = `${deps}/usr/lib/x86_64-linux-gnu${
    process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''
  }`;
  process.env.FONTCONFIG_FILE = `${deps}/etc/fonts/fonts.conf`;
}

const PLAYWRIGHT = process.env.PLAYWRIGHT_CORE ?? findPlaywright();
const CHROMIUM = process.env.CHROMIUM_BIN ?? findChromium();

function findPlaywright() {
  const candidates = [
    resolve(pkgRoot, '../../node_modules/playwright-core/index.mjs'),
    resolve(homedir(), 'src/profullstack/crawlproof.com/node_modules/playwright-core/index.mjs'),
    resolve(homedir(), 'src/profullstack/logicsrc/node_modules/playwright-core/index.mjs'),
  ];
  const found = candidates.find(existsSync);
  if (!found) throw new Error('playwright-core not found — set PLAYWRIGHT_CORE');
  return found;
}

function findChromium() {
  const candidate = resolve(homedir(), '.cache/ms-playwright/chromium-1140/chrome-linux/chrome');
  if (!existsSync(candidate)) throw new Error('chromium not found — set CHROMIUM_BIN');
  return candidate;
}

const CANVAS = { width: 1280, height: 800 };

/**
 * The x402 request the approval shot is rendered from.
 *
 * The approval window normally reads this from the background worker, which
 * only has one when a site is mid-payment. Rather than photograph the
 * "Nothing to approve" empty state — which would say the opposite of what the
 * caption claims — the page's own RPC call is answered with a stand-in
 * request, so the screenshot is the real approval UI with invented values.
 *
 * Because the values are invented, the shot is marked `sample: true` and
 * carries both a "SAMPLE DATA" badge in the frame and a disclosure line in the
 * caption. A store screenshot of a payment tool that shows a specific amount
 * and payee reads as the record of a transaction unless it says otherwise, and
 * an unlabelled one is what Mozilla disabled the 0.10.0 listing over. Keep the
 * values self-evidently fake (see `payTo` below) and keep the label.
 */
const SAMPLE_X402 = {
  kind: 'payX402',
  requestId: 'sample',
  origin: 'https://example.com',
  needsUnlock: false,
  summary: {
    network: 'Base',
    chainId: 8453,
    amount: '2.50',
    assetSymbol: 'USDC',
    // Not a usable address: the zero address is unmistakably a placeholder, so
    // the shot cannot be read as advertising a payment to a real payee.
    payTo: '0x0000000000000000000000000000000000000000',
    resource: 'https://example.com/api/invoices/1234/export',
    description: 'Example invoice — sample data',
  },
};

/**
 * Composite a capture onto the store canvas. Runs inside the browser so the
 * only image dependency is Chromium's own decoder — nothing to install.
 */
async function composite(page, pngBase64, { headline, sub, note, sample }) {
  return page.evaluate(
    async ({ pngBase64, headline, sub, note, sample, CANVAS }) => {
      const canvas = document.createElement('canvas');
      canvas.width = CANVAS.width;
      canvas.height = CANVAS.height;
      const ctx = canvas.getContext('2d');

      const bg = ctx.createLinearGradient(0, 0, CANVAS.width, CANVAS.height);
      bg.addColorStop(0, '#0b1120');
      bg.addColorStop(1, '#15243f');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, CANVAS.width, CANVAS.height);

      const img = new Image();
      await new Promise((done, fail) => {
        img.onload = done;
        img.onerror = fail;
        img.src = `data:image/png;base64,${pngBase64}`;
      });

      // Scale the capture to fill the canvas height with a comfortable margin,
      // and sit it on the right so the caption has the left half to itself.
      const margin = 60;
      const scale = Math.min((CANVAS.height - margin * 2) / img.height, 1.15);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = CANVAS.width - w - 110;
      const y = (CANVAS.height - h) / 2;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 48;
      ctx.shadowOffsetY = 18;
      ctx.fillStyle = '#ffffff';
      const r = 16;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();

      // Shots rendered from stand-in values carry the label in the pixels, not
      // just in the caption — the image travels alone once a store crops it.
      if (sample) {
        const label = 'SAMPLE DATA';
        ctx.font = '700 15px system-ui, sans-serif';
        const padX = 12;
        const bw = ctx.measureText(label).width + padX * 2;
        const bh = 28;
        const bx = x + w - bw - 16;
        const by = y + 16;
        const br = 6;
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(bx + br, by);
        ctx.arcTo(bx + bw, by, bx + bw, by + bh, br);
        ctx.arcTo(bx + bw, by + bh, bx, by + bh, br);
        ctx.arcTo(bx, by + bh, bx, by, br);
        ctx.arcTo(bx, by, bx + bw, by, br);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#0b1120';
        ctx.fillText(label, bx + padX, by + 19);
      }

      // Caption block, wrapped by hand — canvas has no text layout.
      const left = 96;
      ctx.fillStyle = '#7dd3fc';
      ctx.font = '600 20px system-ui, sans-serif';
      ctx.fillText('COINPAY PORTAL WALLET', left, 250);

      ctx.fillStyle = '#ffffff';
      ctx.font = '700 52px system-ui, sans-serif';
      const maxWidth = x - left - 70;
      let lineY = 320;
      for (const line of wrap(ctx, headline, maxWidth)) {
        ctx.fillText(line, left, lineY);
        lineY += 62;
      }

      ctx.fillStyle = '#94a3b8';
      ctx.font = '400 24px system-ui, sans-serif';
      lineY += 12;
      for (const line of wrap(ctx, sub, maxWidth)) {
        ctx.fillText(line, left, lineY);
        lineY += 36;
      }

      if (note) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = '400 18px system-ui, sans-serif';
        lineY += 16;
        for (const line of wrap(ctx, note, maxWidth)) {
          ctx.fillText(line, left, lineY);
          lineY += 26;
        }
      }

      function wrap(context, text, width) {
        const words = text.split(' ');
        const lines = [];
        let current = '';
        for (const word of words) {
          const next = current ? `${current} ${word}` : word;
          if (context.measureText(next).width > width && current) {
            lines.push(current);
            current = word;
          } else {
            current = next;
          }
        }
        if (current) lines.push(current);
        return lines;
      }

      return canvas.toDataURL('image/png').split(',')[1];
    },
    { pngBase64, headline, sub, note, sample, CANVAS },
  );
}

/**
 * Take the extension through the real onboarding flow so the wallet view is
 * photographed with genuine derived addresses rather than an empty state.
 *
 * The seed is generated by the extension inside a throwaway Chromium profile
 * that is discarded when this script exits; it holds no funds and is never
 * written outside that profile. The recovery-phrase step is deliberately not
 * captured.
 */
async function createWallet(page) {
  await page.getByRole('button', { name: 'Create new wallet' }).click();
  await page.waitForSelector('.seed .word');

  const words = await page.$$eval('.seed .word', (nodes) => nodes.map((n) => n.textContent.trim()));
  if (words.length !== 12) throw new Error(`expected a 12-word phrase, got ${words.length}`);

  await page.getByRole('button', { name: "I've saved it" }).click();
  await page.waitForSelector('.confirm-q');

  // Each question names the position it is asking about; the right answer is
  // the word the backup step just showed at that index.
  for (const question of await page.$$('.confirm-q')) {
    const label = await question.$eval('.label', (n) => n.textContent.trim());
    const index = Number(label.replace(/\D+/g, '')) - 1;
    const expected = words[index];
    const buttons = await question.$$('.choices .btn');
    let clicked = false;
    for (const btn of buttons) {
      if ((await btn.textContent()).trim() === expected) {
        await btn.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) throw new Error(`no choice matched word #${index + 1}`);
  }

  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForSelector('input[type="password"]');
  const fields = await page.$$('input[type="password"]');
  const password = 'store-screenshot-only';
  for (const field of fields) await field.fill(password);
  await page.getByRole('button', { name: 'Finish' }).click();

  // The wallet view is the first screen with the tab bar.
  await page.waitForSelector('.tabs', { timeout: 30_000 });
  // Balances are fetched after first paint; give them a moment to resolve.
  await page.waitForTimeout(3500);
}

/**
 * Size the viewport to the content so no dead space is captured.
 *
 * `documentElement.height` is clamped to the viewport on these pages, and the
 * approval window styles `body` to fill it — so both over-report. The bottom
 * edge of the lowest rendered element is the only measure that tracks what is
 * actually drawn.
 */
async function fitToContent(page, width) {
  // Measure against a deliberately short viewport first. The approval window
  // sets `body { min-height: 100vh }` with a flex-filling `#app`, so measuring
  // at the current height just reports the height it was already given.
  await page.setViewportSize({ width, height: 200 });
  await page.waitForTimeout(200);

  const height = await page.evaluate(() => {
    let bottom = 0;
    for (const node of document.body.querySelectorAll('*')) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) bottom = Math.max(bottom, rect.bottom);
    }
    const padding = parseFloat(getComputedStyle(document.body).paddingBottom) || 16;
    return Math.ceil(bottom + padding);
  });
  await page.setViewportSize({ width, height: Math.max(360, Math.min(height, 1100)) });
  await page.waitForTimeout(300);
}

async function main() {
  if (!existsSync(unpacked)) {
    throw new Error(`${unpacked} missing — run \`node scripts/package.mjs\` first`);
  }
  mkdirSync(outDir, { recursive: true });

  const { chromium } = await import(PLAYWRIGHT);
  const context = await chromium.launchPersistentContext('', {
    executablePath: CHROMIUM,
    headless: false, // MV3 service workers do not start in old headless
    args: [
      '--no-sandbox',
      '--headless=new',
      `--disable-extensions-except=${unpacked}`,
      `--load-extension=${unpacked}`,
    ],
  });

  const shots = [];

  try {
    // The extension id is only knowable once the service worker registers.
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    const extensionId = new URL(worker.url()).host;
    process.stdout.write(`[screenshots] extension id ${extensionId}\n`);

    // ── 1. the wallet, after a real create ──────────────────────────────────
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 372, height: 700 });
    await popup.goto(`chrome-extension://${extensionId}/popup/index.html`, {
      waitUntil: 'domcontentloaded',
    });
    await popup.waitForTimeout(600);
    await createWallet(popup);

    // The wallet view paints "Loading balances…" and only lists the derived
    // addresses once the balance call has returned or failed. A fixed wait
    // photographed the placeholder — an empty wallet under a caption about
    // five chains — so wait for the rows themselves and let a timeout fail the
    // run rather than ship a shot of a loading state.
    await popup.waitForSelector('.accounts .account', { timeout: 30_000 });
    await popup
      .waitForFunction(
        () => document.querySelector('.total-value')?.textContent?.trim() !== '…',
        { timeout: 15_000 },
      )
      .catch(() => {
        // Offline or unregistered: the total stays a placeholder but every
        // address and balance below it is real, which is what the shot is for.
      });

    await fitToContent(popup, 372);
    shots.push({
      id: '1-wallet',
      png: await popup.screenshot({ type: 'png' }),
      page: popup,
      headline: 'Your keys, in your browser',
      sub: 'BTC, BCH, ETH, POL and SOL from one BIP-39 phrase — encrypted at rest with AES-256-GCM and never sent anywhere.',
    });

    // ── 2. the x402 approval window ─────────────────────────────────────────
    const approval = await context.newPage();
    await approval.addInitScript((sample) => {
      // The page asks the background worker for the pending request. Answer
      // that one call locally so the real approval UI renders with sample
      // values; everything else falls through untouched.
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (message, ...rest) => {
        if (message?.type === 'approval:get') {
          return Promise.resolve({ ok: true, approval: sample });
        }
        return original(message, ...rest);
      };
    }, SAMPLE_X402);
    await approval.setViewportSize({ width: 412, height: 700 });
    await approval.goto(
      `chrome-extension://${extensionId}/approval/index.html?requestId=${SAMPLE_X402.requestId}`,
      { waitUntil: 'domcontentloaded' },
    );
    await approval.waitForTimeout(1500);
    await fitToContent(approval, 412);
    shots.push({
      id: '2-approve',
      png: await approval.screenshot({ type: 'png' }),
      page: approval,
      headline: 'One click to pay',
      sub: 'Sites request payment over x402. You see the amount, the chain and the payee before anything is signed.',
      note: 'Illustration only. The amount, payee and invoice shown are made-up placeholders — this is not a record of a real payment.',
      sample: true,
    });

    for (const shot of shots) {
      writeFileSync(resolve(outDir, `raw-${shot.id}.png`), shot.png);
      const composed = await composite(shot.page, shot.png.toString('base64'), shot);
      writeFileSync(resolve(outDir, `${shot.id}-1280x800.png`), Buffer.from(composed, 'base64'));
      process.stdout.write(`[screenshots] ${shot.id}-1280x800.png\n`);
    }
  } finally {
    await context.close();
  }

  process.stdout.write(`[screenshots] wrote ${outDir}\n`);
}

await main();
