#!/usr/bin/env node
/**
 * Version bump script for @profullstack/coinpay SDK
 * Usage: node scripts/version-bump.js [patch|minor|major]
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const sdkDir = resolve(rootDir, 'packages/sdk');

const bumpType = process.argv[2] || 'patch';

if (!['patch', 'minor', 'major'].includes(bumpType)) {
  console.error('Usage: node scripts/version-bump.js [patch|minor|major]');
  process.exit(1);
}

function run(cmd, cwd = sdkDir) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'inherit' });
}

function runCapture(cmd, cwd = sdkDir) {
  return execSync(cmd, { cwd, encoding: 'utf-8' }).trim();
}

try {
  // 1. Bump version in package.json
  console.log(`\n📦 Bumping ${bumpType} version...\n`);
  run(`npm version ${bumpType} --no-git-tag-version`);
  
  // 2. Get new version
  const pkgPath = resolve(sdkDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const newVersion = pkg.version;
  console.log(`\n✓ New version: ${newVersion}\n`);
  
  // 3. Update CLI VERSION constant
  const cliPath = resolve(sdkDir, 'bin/coinpay.js');
  let cliCode = readFileSync(cliPath, 'utf-8');
  cliCode = cliCode.replace(/const VERSION = '[^']+';/, `const VERSION = '${newVersion}';`);
  writeFileSync(cliPath, cliCode);
  console.log(`✓ Updated CLI version constant\n`);
  
  // 4. Publish to npm
  console.log(`📤 Publishing to npm...\n`);
  run('npm publish --access public --ignore-scripts');
  
  // 5. Commit and push
  console.log(`\n📝 Committing changes...\n`);
  run(`git add packages/sdk/package.json packages/sdk/bin/coinpay.js`, rootDir);
  run(`git commit --no-verify -m "chore: bump @profullstack/coinpay to ${newVersion}"`, rootDir);
  run('git push', rootDir);
  
  // 6. Update global install
  console.log(`\n🔄 Updating global install...\n`);
  execSync(`sudo npm install -g @profullstack/coinpay@${newVersion}`, { stdio: 'inherit' });
  
  console.log(`\n✅ Successfully published @profullstack/coinpay@${newVersion}\n`);
  
} catch (err) {
  console.error('\n❌ Version bump failed:', err.message);
  process.exit(1);
}
