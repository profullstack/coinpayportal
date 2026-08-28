#!/usr/bin/env node
/**
 * Build every distribution channel of the CoinPay Portal Wallet extension and write
 * store-ready archives to `packages/extension/release/`.
 *
 *   node scripts/package.mjs
 *
 * Channels, and why each one is a separate archive rather than one zip reused:
 *
 *   chrome    Chrome Web Store. The `key` field is stripped — the Web Store
 *             mints its own extension id, and shipping a foreign key is at best
 *             ignored and at worst rejected.
 *   firefox   addons.mozilla.org. Keeps `browser_specific_settings.gecko.id`,
 *             which is what AMO uses as the add-on identity.
 *   safari    Input to `xcrun safari-web-extension-converter` on a Mac. Also
 *             left unpacked, because the converter takes a directory.
 *   selfhost  The GitHub `extension-v*` release asset and the tronbrowser.dev
 *             store. This is the ONLY archive that keeps `key`, so the id that
 *             existing users already have installed
 *             (jmojjohoigoecfkjlobdmiejcdjjbhnb) does not change under them.
 *   source    AMO requires the original sources whenever the uploaded package
 *             was produced by a bundler. Reviewers must be able to reproduce
 *             `dist/` from it, so it carries the package sources plus the
 *             workspace files needed to install and run the build.
 *
 * Store builds also drop the `http://localhost/*` and `http://127.0.0.1/*`
 * host permissions. They exist for local x402 development, they are the single
 * most commonly challenged permission in review, and a developer testing
 * locally loads the extension unpacked anyway. The self-hosted build keeps
 * them.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, writeZip } from './zip.mjs';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(pkgRoot, '../..');
const releaseDir = resolve(pkgRoot, 'release');

const { version } = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8'));

const LOCAL_HOSTS = ['http://localhost/*', 'http://127.0.0.1/*'];

/** manifest target -> { keepKey, keepLocalhost } */
const CHANNELS = {
  chrome: { target: 'chrome', keepKey: false, keepLocalhost: false },
  firefox: { target: 'firefox', keepKey: false, keepLocalhost: false },
  safari: { target: 'safari', keepKey: false, keepLocalhost: false },
  selfhost: { target: 'chrome', keepKey: true, keepLocalhost: true },
};

function log(message) {
  process.stdout.write(`[package] ${message}\n`);
}

/**
 * pnpm may hoist vite to the workspace root or keep it under the package —
 * resolve it rather than guessing, so this runs the same in CI and locally.
 */
const viteBin = (() => {
  for (const candidate of [
    resolve(pkgRoot, 'node_modules/vite/bin/vite.js'),
    resolve(repoRoot, 'node_modules/vite/bin/vite.js'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('vite not found — run `pnpm install --filter @profullstack/coinpay-extension...`');
})();

function build(target, outDir) {
  execFileSync(process.execPath, [viteBin, 'build', '--config', 'vite.config.ts'], {
    cwd: pkgRoot,
    env: { ...process.env, TARGET: target, OUT_DIR: outDir },
    stdio: 'pipe',
  });
}

/** Apply the per-channel manifest transforms in place inside `outDir`. */
function rewriteManifest(outDir, { keepKey, keepLocalhost }) {
  const path = resolve(outDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));

  if (!keepKey) delete manifest.key;

  if (!keepLocalhost) {
    const strip = (list) => list?.filter((entry) => !LOCAL_HOSTS.includes(entry));
    manifest.host_permissions = strip(manifest.host_permissions);
    for (const script of manifest.content_scripts ?? []) script.matches = strip(script.matches);
    for (const war of manifest.web_accessible_resources ?? []) war.matches = strip(war.matches);
  }

  if (manifest.version !== version) {
    throw new Error(
      `manifest version ${manifest.version} does not match package.json ${version} — ` +
        'bump manifest/manifest.*.json together with package.json',
    );
  }

  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/**
 * The archive AMO reviewers use to reproduce the build. It is deliberately not
 * a `git archive` of the whole monorepo: reviewers need the extension package
 * and the workspace manifests that pin its dependencies, and nothing else.
 */
function packageSource(outPath) {
  const entries = [
    ...collect(pkgRoot, { exclude: ['dist', 'release', 'node_modules', 'store-assets'] }).map((entry) => ({
      name: `packages/extension/${entry.name}`,
      data: entry.data,
    })),
  ];

  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    const full = resolve(repoRoot, file);
    if (!existsSync(full)) throw new Error(`source archive needs ${file} at the repo root`);
    entries.push({ name: file, data: readFileSync(full) });
  }

  // The `@profullstack/coinpay` workspace dependency supplies BIP-44/SLIP-0010
  // derivation; without it `pnpm install` in the archive cannot resolve.
  const sdk = resolve(repoRoot, 'packages/coinpay');
  if (existsSync(sdk)) {
    for (const entry of collect(sdk, { exclude: ['dist', 'node_modules', 'coverage'] })) {
      entries.push({ name: `packages/coinpay/${entry.name}`, data: entry.data });
    }
  }

  entries.push({ name: 'BUILD.md', data: Buffer.from(SOURCE_BUILD_INSTRUCTIONS, 'utf8') });
  return writeZip(outPath, entries.sort((a, b) => (a.name < b.name ? -1 : 1)));
}

const SOURCE_BUILD_INSTRUCTIONS = `# Reproducing the uploaded package

Built and verified on Node 24 with pnpm 11 (Linux and macOS both work).

    corepack enable
    pnpm install --filter @profullstack/coinpay-extension...
    TARGET=firefox OUT_DIR=dist node node_modules/vite/bin/vite.js build \\
      --config vite.config.ts   # run from packages/extension

That writes \`packages/extension/dist/\`, whose contents are the uploaded
archive with two edits applied by \`scripts/package.mjs\`:

  1. \`key\` is removed from the manifest (Chrome Web Store only ships that
     field on the self-hosted build).
  2. The \`http://localhost/*\` and \`http://127.0.0.1/*\` host permissions,
     which exist for local development, are removed from store builds.

The build is not minified (\`minify: false\` in \`vite.config.ts\`), so every
file in the archive maps line-for-line onto the TypeScript it came from.
`;

function main() {
  // `release/` is disposable build output and is gitignored; the listing
  // screenshots live in the versioned `store-assets/` instead, so clearing
  // this wholesale cannot take them with it.
  rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(releaseDir, { recursive: true });

  const summary = [];

  for (const [channel, options] of Object.entries(CHANNELS)) {
    const unpacked = resolve(releaseDir, `unpacked-${channel}`);
    build(options.target, unpacked);
    const manifest = rewriteManifest(unpacked, options);

    const zipPath = resolve(releaseDir, `coinpay-wallet-${version}-${channel}.zip`);
    const entries = collect(unpacked);
    const bytes = writeZip(zipPath, entries);

    summary.push({ channel, zip: zipPath, bytes, files: entries.length, manifest });
    log(
      `${channel.padEnd(8)} ${entries.length} files, ${(bytes / 1024).toFixed(1)} KB` +
        `${manifest.key ? ' (keeps key)' : ''}`,
    );
  }

  const sourceZip = resolve(releaseDir, `coinpay-wallet-${version}-source.zip`);
  const sourceBytes = packageSource(sourceZip);
  log(`source   ${(sourceBytes / 1024).toFixed(1)} KB`);

  // The self-hosted archive is what the GitHub release and tronbrowser.dev
  // consume, under the fixed name both already expect.
  const canonical = resolve(releaseDir, 'coinpay-wallet.zip');
  writeFileSync(canonical, readFileSync(resolve(releaseDir, `coinpay-wallet-${version}-selfhost.zip`)));
  log(`wrote ${canonical}`);

  log(`version ${version} — release/ ready`);
  return summary;
}

main();
