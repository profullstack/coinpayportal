#!/usr/bin/env node
/**
 * Submit the extension to addons.mozilla.org.
 *
 *   node scripts/publish-firefox.mjs --validate   # upload + linter report only
 *   node scripts/publish-firefox.mjs --create     # first-ever listing
 *   node scripts/publish-firefox.mjs --version    # a new version of the listing
 *
 * Credentials (the `brisk-news-extensions` logicsrc vault holds the shared
 * Profullstack, Inc. AMO account):
 *
 *   FIREFOX_JWT_ISSUER, FIREFOX_JWT_SECRET
 *
 * Unlike the Chrome Web Store, AMO's API covers the whole submission: package,
 * listing copy, categories, licence and the source archive. The one thing it
 * cannot skip is review — a listed add-on that requests host permissions and
 * ships a bundled build goes to a human queue.
 *
 * The source archive is not optional. AMO policy requires the original sources
 * whenever the uploaded files were produced by a build tool, and a submission
 * without it is rejected at review rather than at upload — days later. It is
 * attached here in the same run.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8'));
const listing = JSON.parse(readFileSync(resolve(pkgRoot, 'store-listing.json'), 'utf8'));

const xpiPath = resolve(pkgRoot, `release/coinpay-wallet-${version}-firefox.zip`);
const sourcePath = resolve(pkgRoot, `release/coinpay-wallet-${version}-source.zip`);

const API = 'https://addons.mozilla.org/api/v5';
const args = new Set(process.argv.slice(2));

/** AMO wants a fresh short-lived HS256 token per request, not a session. */
function jwt() {
  const issuer = process.env.FIREFOX_JWT_ISSUER;
  const secret = process.env.FIREFOX_JWT_SECRET;
  if (!issuer || !secret) throw new Error('FIREFOX_JWT_ISSUER / FIREFOX_JWT_SECRET are not set');

  const b64 = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ iss: issuer, jti: randomBytes(8).toString('hex'), iat, exp: iat + 280 });
  const sig = createHmac('sha256', secret).update(`${head}.${payload}`).digest('base64url');
  return `${head}.${payload}.${sig}`;
}

async function api(path, { method = 'GET', json, form } = {}) {
  const headers = { authorization: `JWT ${jwt()}`, 'user-agent': 'coinpay-extension-release/1.0' };
  let body;
  if (json) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }

  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    headers,
    body,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(parsed).slice(0, 1200)}`);
  }
  return parsed;
}

function fileForm(field, path, extra = {}) {
  const form = new FormData();
  form.set(field, new Blob([readFileSync(path)], { type: 'application/zip' }), basename(path));
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

/** Upload the package and wait for AMO's linter to finish with it. */
async function uploadAndValidate() {
  if (!existsSync(xpiPath)) {
    throw new Error(`${xpiPath} missing — run \`node scripts/package.mjs\` first`);
  }
  const started = await api('/addons/upload/', {
    method: 'POST',
    form: fileForm('upload', xpiPath, { channel: 'listed' }),
  });
  process.stdout.write(`[firefox] upload ${started.uuid}\n`);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await api(`/addons/upload/${started.uuid}/`);
    if (status.processed) {
      const { errors = 0, warnings = 0, notices = 0, messages = [] } = status.validation ?? {};
      process.stdout.write(
        `[firefox] linter: ${errors} errors, ${warnings} warnings, ${notices} notices\n`,
      );
      for (const message of messages.filter((m) => m.type === 'error' || m.type === 'warning')) {
        process.stdout.write(`[firefox]   ${message.type}: ${message.message}\n`);
      }
      if (!status.valid) throw new Error('AMO rejected the package — fix the errors above');
      return status;
    }
    await new Promise((done) => setTimeout(done, 3000));
  }
  throw new Error('AMO validation did not finish within 3 minutes');
}

/** Localised strings are `{ "en-US": ... }` maps throughout the AMO API. */
const en = (text) => ({ 'en-US': text });

/**
 * Attach the listing screenshots. Separate from the add-on create call —
 * previews are their own collection on AMO, and a listing submitted without
 * them shows a blank gallery on the public page.
 */
async function uploadPreviews(addonId) {
  const dir = resolve(pkgRoot, 'store-assets');
  const shots = [
    { file: '1-wallet-1280x800.png', caption: 'Every chain from one recovery phrase, encrypted on your device.' },
    { file: '2-approve-1280x800.png', caption: 'x402 payments show the amount, chain and payee before you sign.' },
  ];

  const existing = await api(`/addons/addon/${addonId}/previews/`).catch(() => ({ results: [] }));
  if ((existing.results ?? existing)?.length) {
    process.stdout.write('[firefox] previews already attached — leaving them alone\n');
    return;
  }

  for (const [index, shot] of shots.entries()) {
    const path = resolve(dir, shot.file);
    if (!existsSync(path)) {
      process.stdout.write(`[firefox] no ${shot.file} — run scripts/make-screenshots.mjs\n`);
      continue;
    }
    const form = new FormData();
    form.set('image', new Blob([readFileSync(path)], { type: 'image/png' }), shot.file);
    // Localised fields are objects, and multipart has no nesting — AMO reads
    // them from bracketed field names rather than a JSON-encoded string.
    form.set('caption[en-US]', shot.caption);
    form.set('position', String(index));
    await api(`/addons/addon/${addonId}/previews/`, { method: 'POST', form });
    process.stdout.write(`[firefox] preview ${shot.file}\n`);
  }
}

async function main() {
  // Screenshots are listing metadata, not a version — attaching them must not
  // require pushing a package the store has already got.
  if (args.has('--previews')) {
    const addonId = process.env.FIREFOX_ADDON_ID;
    if (!addonId) throw new Error('FIREFOX_ADDON_ID is not set');
    await uploadPreviews(addonId);
    return;
  }

  const upload = await uploadAndValidate();
  if (args.has('--validate')) {
    process.stdout.write('[firefox] validate-only — nothing submitted\n');
    return;
  }

  let addonId = process.env.FIREFOX_ADDON_ID;
  let versionId;

  if (args.has('--create')) {
    const created = await api('/addons/addon/', {
      method: 'POST',
      json: {
        categories: listing.firefox.categories,
        slug: listing.firefox.slug,
        name: en(listing.name),
        summary: en(listing.summary),
        description: en(listing.description),
        homepage: en(listing.homepageUrl),
        support_url: en(listing.supportUrl),
        privacy_policy: en(listing.firefox.privacyPolicyText),
        is_experimental: false,
        requires_payment: false,
        tags: [],
        version: {
          upload: upload.uuid,
          license: listing.license,
          approval_notes: listing.firefox.reviewerNotes,
        },
      },
    });
    addonId = created.id;
    versionId = created.version?.id;
    process.stdout.write(`[firefox] created addon ${created.slug} (id ${addonId})\n`);
  } else {
    if (!addonId) throw new Error('FIREFOX_ADDON_ID is unset — pass --create for the first listing');
    const created = await api(`/addons/addon/${addonId}/versions/`, {
      method: 'POST',
      json: {
        upload: upload.uuid,
        license: listing.license,
        approval_notes: listing.firefox.reviewerNotes,
      },
    });
    versionId = created.id;
    process.stdout.write(`[firefox] added version ${created.version} to ${addonId}\n`);
  }

  // Sources, in the same run — a submission missing them fails at review.
  if (versionId && existsSync(sourcePath)) {
    await api(`/addons/addon/${addonId}/versions/${versionId}/`, {
      method: 'PATCH',
      form: fileForm('source', sourcePath),
    });
    process.stdout.write('[firefox] attached source archive\n');
  }

  await uploadPreviews(addonId);

  process.stdout.write(
    `[firefox] submitted — https://addons.mozilla.org/en-US/developers/addon/${
      addonId
    }/versions\n`,
  );
}

await main();
