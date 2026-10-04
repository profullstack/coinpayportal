#!/usr/bin/env node
/**
 * Upload — and optionally publish — the Chrome Web Store package.
 *
 *   node scripts/publish-chrome.mjs                # upload to the draft
 *   node scripts/publish-chrome.mjs --create       # mint a NEW store item first
 *   node scripts/publish-chrome.mjs --publish      # upload, then submit for review
 *
 * Credentials come from the environment (the `brisk-news-extensions` logicsrc
 * vault holds the shared Profullstack Web Store account):
 *
 *   CHROME_CLIENT_ID, CHROME_CLIENT_SECRET, CHROME_REFRESH_TOKEN
 *   CHROME_EXTENSION_ID   the item to update; omit only with --create
 *
 * What this cannot do, and why: the Web Store Publish API covers exactly two
 * operations — put a package on an item, and publish that item. Listing copy,
 * screenshots, category, and the privacy/permission justifications are only
 * settable in the Developer Dashboard. `--publish` on an item whose listing
 * has never been filled in will be rejected by the store, which is the correct
 * outcome rather than something to work around.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8'));
const zipPath = resolve(pkgRoot, `release/coinpay-wallet-${version}-chrome.zip`);

const args = new Set(process.argv.slice(2));
const wantCreate = args.has('--create');
const wantPublish = args.has('--publish');

function required(name) {
  const value = process.env[name];
  if (!value || value.startsWith('<')) throw new Error(`${name} is not set`);
  return value;
}

async function accessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: required('CHROME_CLIENT_ID'),
      client_secret: required('CHROME_CLIENT_SECRET'),
      refresh_token: required('CHROME_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

/**
 * POST creates a new item and returns the id the store minted; PUT replaces
 * the package on an existing one. Both stream the raw zip as the body.
 */
async function upload(token, zip, itemId) {
  const base = 'https://www.googleapis.com/upload/chromewebstore/v1.1/items';
  const url = itemId ? `${base}/${itemId}` : base;
  const res = await fetch(url, {
    method: itemId ? 'PUT' : 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-goog-api-version': '2',
      'content-type': 'application/zip',
    },
    body: zip,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`upload failed (${res.status}): ${JSON.stringify(body)}`);
  if (body.uploadState === 'FAILURE') {
    throw new Error(`store rejected the package: ${JSON.stringify(body.itemError ?? body)}`);
  }
  return body;
}

async function publish(token, itemId) {
  const res = await fetch(
    `https://www.googleapis.com/chromewebstore/v1.1/items/${itemId}/publish?publishTarget=default`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-goog-api-version': '2',
        'content-length': '0',
      },
    },
  );
  const body = await res.json();
  if (!res.ok) throw new Error(`publish failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  if (!existsSync(zipPath)) {
    throw new Error(`${zipPath} missing — run \`node scripts/package.mjs\` first`);
  }
  const zip = readFileSync(zipPath);
  const token = await accessToken();

  const existingId = process.env.CHROME_EXTENSION_ID?.startsWith('<')
    ? undefined
    : process.env.CHROME_EXTENSION_ID;

  if (!wantCreate && !existingId) {
    throw new Error('CHROME_EXTENSION_ID is unset — pass --create to mint a new store item');
  }

  const target = wantCreate ? undefined : existingId;
  const result = await upload(token, zip, target);
  const itemId = result.id ?? target;

  process.stdout.write(
    `[chrome] ${wantCreate ? 'created' : 'updated'} item ${itemId} — ` +
      `uploadState=${result.uploadState} v${version}\n`,
  );
  if (wantCreate) {
    process.stdout.write(
      `[chrome] store this in the vault: CHROME_EXTENSION_ID=${itemId}\n` +
        `[chrome] listing: https://chrome.google.com/webstore/devconsole/…/${itemId}/edit\n`,
    );
  }

  if (wantPublish) {
    const published = await publish(token, itemId);
    process.stdout.write(`[chrome] publish → ${JSON.stringify(published.status ?? published)}\n`);
  } else {
    process.stdout.write('[chrome] not published — pass --publish once the listing is complete\n');
  }
}

await main();
