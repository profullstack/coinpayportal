import 'server-only';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { GUIDE_FILENAME } from './lead.mjs';

/**
 * True only when the release PDF is actually present on disk and is really a
 * PDF (starts with `%PDF-`). The promotion and the lead form are gated on this
 * so the site never advertises or collects a lead for a download it cannot
 * deliver; the moment the asset is committed to `public/guides/`, the page
 * lights up with no further code change.
 */
export async function guideAvailable(): Promise<boolean> {
  try {
    const file = await open(path.join(process.cwd(), 'public', 'guides', GUIDE_FILENAME), 'r');
    try {
      const signature = Buffer.alloc(5);
      await file.read(signature, 0, 5, 0);
      return signature.toString() === '%PDF-';
    } finally {
      await file.close();
    }
  } catch {
    return false;
  }
}
