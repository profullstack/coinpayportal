/**
 * HTML to PDF, using whatever browser this machine already has.
 *
 * Deliberately not a dependency. Adding Puppeteer to a payments CLI pulls a
 * ~150MB browser download into every install so that a minority of runs can
 * print a document, and the machines that want the PDF usually already have a
 * browser from some other tool. So: look for one, use it, and when there is
 * none say exactly what to install rather than failing with a stack trace.
 *
 * The HTML is always written either way. A report you can open and print by
 * hand is a working report; a missing browser should downgrade the output, not
 * lose the work.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

/** Names a system browser might have on PATH. */
const PATH_NAMES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'microsoft-edge',
  'brave-browser',
];

function onPath(name) {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const file = path.join(dir, name);
    if (existsSync(file)) return file;
  }
  return null;
}

/** Browsers that Playwright and Puppeteer download for their own use. */
function fromCaches() {
  const found = [];
  const roots = [
    { dir: path.join(homedir(), '.cache', 'ms-playwright'), rel: ['chrome-linux', 'chrome'] },
    { dir: path.join(homedir(), '.cache', 'puppeteer', 'chrome'), rel: ['chrome-linux64', 'chrome'] },
  ];
  for (const { dir, rel } of roots) {
    if (!existsSync(dir)) continue;
    let entries = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(dir, entry, ...rel);
      if (existsSync(candidate)) found.push(candidate);
    }
  }
  // Newest download first: the directory names carry versions.
  return found.sort().reverse();
}

export function browserCandidates(env = process.env) {
  const out = [];
  if (env.COINPAY_CHROME) out.push(env.COINPAY_CHROME);
  for (const name of PATH_NAMES) {
    const file = onPath(name);
    if (file) out.push(file);
  }
  out.push(...fromCaches());
  return out;
}

function run(file, args, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, stderr: String(error?.message ?? error) });
      return;
    }
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stderr: String(error?.message ?? error) });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stderr });
    });
  });
}

/**
 * Render `html` to `pdfPath`.
 *
 * Returns what actually happened rather than throwing, because "no browser" is
 * an ordinary outcome here and the caller has something useful to say about it.
 */
export async function htmlToPdf(html, pdfPath, { timeoutMs = 120_000, env = process.env } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'coinpay-report-'));
  const htmlPath = path.join(dir, 'report.html');
  writeFileSync(htmlPath, html, 'utf8');

  const candidates = browserCandidates(env);
  const tried = [];

  for (const browser of candidates) {
    const result = await run(
      browser,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--no-pdf-header-footer',
        `--print-to-pdf=${pdfPath}`,
        `file://${htmlPath}`,
      ],
      timeoutMs,
    );
    if (result.ok && existsSync(pdfPath)) return { ok: true, pdfPath, htmlPath, browser };
    // A cached browser with no system libraries is the common failure, and its
    // message is the useful part, so it is kept rather than flattened.
    tried.push({ browser, reason: (result.stderr || `exit ${result.code}`).trim().split('\n')[0] });
  }

  return { ok: false, htmlPath, tried };
}

/** What to tell someone whose machine could not print. */
export function installHint(tried = []) {
  const missingLibs = tried.some((t) => /error while loading shared libraries|cannot open shared object/.test(t.reason ?? ''));
  if (missingLibs) {
    return 'A browser was found but is missing system libraries. Install them with:\n  npx playwright install-deps chromium';
  }
  if (!tried.length) {
    return 'No browser found. Install one, or point COINPAY_CHROME at a Chrome or Chromium binary:\n  npx playwright install --with-deps chromium';
  }
  return 'No browser could print the report. Point COINPAY_CHROME at a working Chrome or Chromium binary.';
}
