import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(await readFile(new URL('../docs/field-guide-asset.json', import.meta.url), 'utf8'));
const asset = new URL(`../${manifest.path}`, import.meta.url);
try {
  const bytes = await readFile(asset);
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Not a PDF');
  if (bytes.length !== manifest.bytes || createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new Error('PDF does not match the expected publication manifest');
  console.log(`Verified ${manifest.filename}: ${manifest.pages} pages, ${bytes.length} bytes`);
} catch (error) {
  console.error(`Field guide release blocked: ${manifest.path}`);
  console.error(error instanceof Error ? error.message : 'Asset verification failed');
  process.exitCode = 1;
}
