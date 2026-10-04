import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(await readFile(new URL('../docs/field-guide-asset.json', import.meta.url), 'utf8'));
const asset = new URL(`../${manifest.path}`, import.meta.url);
let bytes;
try {
  bytes = await readFile(asset);
} catch (error) {
  if (error && error.code === 'ENOENT') {
    // Absent is a safe state: the promotion, the /get-guide form and the API
    // all gate on the asset being present (src/lib/field-guide/asset.ts), so
    // the site never advertises or serves a download it does not have. Commit
    // the real PDF to light the page up; this check then enforces the manifest.
    console.warn(`Field guide asset not committed yet: ${manifest.path}`);
    console.warn('The site hides the guide until it is present; nothing to verify.');
    process.exit(0);
  }
  throw error;
}
try {
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Not a PDF');
  if (bytes.length !== manifest.bytes || createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new Error('PDF does not match the expected publication manifest');
  console.log(`Verified ${manifest.filename}: ${manifest.pages} pages, ${bytes.length} bytes`);
} catch (error) {
  console.error(`Field guide release blocked: ${manifest.path}`);
  console.error(error instanceof Error ? error.message : 'Asset verification failed');
  process.exitCode = 1;
}
