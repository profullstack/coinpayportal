#!/usr/bin/env node
/**
 * Unified version bump for the whole CoinPay monorepo.
 *
 * One command, one version everywhere: root package.json, the JS SDK, the
 * SDK CLI, the shared PHP client, the WooCommerce plugin, the WHMCS plugin,
 * the release build script, and the vendored copies inside each plugin.
 *
 * Usage:
 *   node scripts/version-bump.js [patch|minor|major]
 *
 * Run via pnpm:
 *   pnpm version:patch
 *   pnpm version:minor
 *   pnpm version:major
 *
 * Side effects (in order):
 *   1. Rewrites every version reference to the new version.
 *   2. Runs scripts/sync-plugin-sdk.sh so vendored PHP copies stay in lockstep.
 *   3. Publishes the JS SDK to npm.
 *   4. Commits the bump (with --no-verify, because the pre-commit hook runs
 *      the full Next.js build — too slow to gate every release bump).
 *   5. Pushes the commit to origin.
 *   6. Updates the global `coinpay` CLI install.
 *
 * What it does NOT do:
 *   - Create or push git tags. Tagging is still manual because pushing a
 *     `plugins-v*` tag triggers the plugin release workflow (GitHub Release,
 *     optional WP.org SVN deploy) — that should be a deliberate step.
 *
 * Why self-healing matches (group-capture, not literal old-version): some
 * files can drift between releases. The script parses the current value from
 * each file independently and rewrites to the new target, so a misaligned
 * file (say plugins still on 0.1.0 while SDK is on 0.6.11) snaps into line
 * on the first bump.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const args = process.argv.slice(2);
const bumpType = args.find((a) => !a.startsWith('--')) || 'patch';
const dryRun = args.includes('--dry-run');

if (!['patch', 'minor', 'major'].includes(bumpType)) {
  console.error('Usage: node scripts/version-bump.js [patch|minor|major] [--dry-run]');
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { cwd: rootDir, stdio: 'inherit', ...opts });
}

function bumpSemver(version, type) {
  const parts = version.split('.').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Unexpected version string: ${version}`);
  }
  if (type === 'major') return `${parts[0] + 1}.0.0`;
  if (type === 'minor') return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

/**
 * Each target = one (file, regex) pair. The regex must have exactly one
 * capture group for the current version number so we can rewrite it
 * in-place without requiring all files to be pre-aligned.
 */
const TARGETS = [
  {
    file: 'package.json',
    label: 'root package.json',
    pattern: /("version"\s*:\s*")(\d+\.\d+\.\d+)(")/,
  },
  {
    file: 'packages/sdk/package.json',
    label: 'SDK package.json',
    pattern: /("version"\s*:\s*")(\d+\.\d+\.\d+)(")/,
  },
  // Note: packages/sdk/bin/coinpay.js reads its VERSION from package.json at
  // runtime, so there's no string literal to bump here.
  {
    file: 'packages/coinpay-php/src/Client.php',
    label: 'shared PHP client USER_AGENT',
    pattern: /(USER_AGENT\s*=\s*'coinpay-php\/)(\d+\.\d+\.\d+)(')/,
  },
  {
    file: 'plugins/woocommerce/coinpay-woocommerce/coinpay-woocommerce.php',
    label: 'WooCommerce plugin header Version',
    pattern: /(\*\s+Version:\s+)(\d+\.\d+\.\d+)(\b)/,
  },
  {
    file: 'plugins/woocommerce/coinpay-woocommerce/coinpay-woocommerce.php',
    label: 'COINPAY_WC_VERSION constant',
    pattern: /(define\('COINPAY_WC_VERSION',\s*')(\d+\.\d+\.\d+)('\);)/,
  },
  {
    file: 'plugins/woocommerce/coinpay-woocommerce/readme.txt',
    label: 'readme.txt Stable tag',
    pattern: /(Stable tag:\s*)(\d+\.\d+\.\d+)(\b)/,
  },
  {
    file: 'plugins/whmcs/modules/gateways/coinpay.php',
    label: 'WHMCS plugin_version metadata',
    pattern: /('plugin_version'\s*=>\s*')(\d+\.\d+\.\d+)(')/,
  },
  {
    file: 'scripts/build-plugin-zips.sh',
    label: 'build-plugin-zips.sh default version',
    pattern: /(COINPAY_PLUGIN_VERSION:-)(\d+\.\d+\.\d+)(\})/,
  },
];

// Files committed at the end. Vendored PHP copies are added dynamically after sync.
const COMMITTED_FILES = new Set(TARGETS.map((t) => t.file).concat([
  'plugins/woocommerce/coinpay-woocommerce/lib/CoinPay/Client.php',
  'plugins/whmcs/modules/gateways/coinpay/lib/CoinPay/Client.php',
]));

function applyEdit(edit, newVersion) {
  const abs = resolve(rootDir, edit.file);
  const contents = readFileSync(abs, 'utf-8');
  const matches = contents.match(new RegExp(edit.pattern.source, 'g'));
  const count = matches ? matches.length : 0;
  if (count !== 1) {
    throw new Error(
      `${edit.file}: expected 1 match for "${edit.label}", found ${count}. ` +
        `Pattern: ${edit.pattern.source}`,
    );
  }
  const m = contents.match(edit.pattern);
  const oldVersion = m[2];
  const updated = contents.replace(edit.pattern, `$1${newVersion}$3`);
  if (!dryRun) {
    writeFileSync(abs, updated);
  }
  return { from: oldVersion, to: newVersion };
}

try {
  // Derive the new version from root package.json (source of truth).
  const rootPkgPath = resolve(rootDir, 'package.json');
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
  const currentVersion = rootPkg.version;
  const newVersion = bumpSemver(currentVersion, bumpType);

  console.log(`\n📦 Bumping ${bumpType}: ${currentVersion} → ${newVersion}${dryRun ? ' (dry run)' : ''}\n`);

  // Apply all edits.
  const drift = [];
  for (const edit of TARGETS) {
    const res = applyEdit(edit, newVersion);
    const driftLabel = res.from === currentVersion ? '' : `  [from ${res.from} — was drifted]`;
    console.log(`  ✓ ${edit.file}: ${edit.label}${driftLabel}`);
    if (res.from !== currentVersion) {
      drift.push({ file: edit.file, label: edit.label, from: res.from });
    }
  }

  if (dryRun) {
    console.log('\n(dry run — nothing written, no sync/publish/commit/push performed)');
    if (drift.length > 0) {
      console.log('\nFiles that would be aligned:');
      for (const d of drift) {
        console.log(`  • ${d.file} (${d.label}): ${d.from} → ${newVersion}`);
      }
    }
    process.exit(0);
  }

  // Refresh vendored copies of the shared PHP client in each plugin.
  console.log('\n🔄 Syncing vendored PHP client into each plugin...');
  run('./scripts/sync-plugin-sdk.sh');

  // Publish the JS SDK to npm.
  console.log('\n📤 Publishing @profullstack/coinpay to npm...');
  run('npm publish --access public --ignore-scripts', { cwd: resolve(rootDir, 'packages/sdk') });

  // Commit everything together. --no-verify because the pre-commit hook
  // runs `pnpm build` + full vitest suite, which takes long enough that
  // every release bump would be annoying. If CI on master catches it,
  // we'll see it there.
  console.log('\n📝 Committing bump...');
  run(`git add -- ${[...COMMITTED_FILES].join(' ')}`);
  run(`git commit --no-verify -m "chore: bump CoinPay to ${newVersion}"`);

  // Push commit to origin master. Tags are still manual.
  console.log('\n🚀 Pushing to origin...');
  run('git push');

  // Keep the globally installed CLI current.
  console.log('\n🔄 Updating global CLI install...');
  try {
    run(`sudo npm install -g @profullstack/coinpay@${newVersion}`);
  } catch (err) {
    console.warn(`(non-fatal) Global install skipped: ${err.message}`);
  }

  console.log(`\n✅ CoinPay ${newVersion} published and committed.`);
  if (drift.length > 0) {
    console.log('\nNote: the following files were out of sync and have been aligned:');
    for (const d of drift) {
      console.log(`  • ${d.file} (${d.label}): ${d.from} → ${newVersion}`);
    }
  }
  console.log('\nTo release the plugins, tag and push when ready:');
  console.log(`  git tag -a plugins-v${newVersion} -m "CoinPay plugins v${newVersion}"`);
  console.log(`  git push origin plugins-v${newVersion}`);
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
}
