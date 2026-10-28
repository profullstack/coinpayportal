import 'server-only';
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readdir, readFile, rename, rm, writeFile, stat } from 'fs/promises';
import path from 'path';
import { requireEncryptionKey } from '../crypto/require-key';
import { legacyKeyMigrationEnabled } from '../crypto/legacy-migration';
import { isSealedBinary } from '../vault/sealed-vault';
import { getVaultPublicKey, merchantUnlocked, openBinaryFor, sealBinaryFor, VaultLockedError } from '../vault/vault-service';

/**
 * Private file storage for finance documents: rendered report artifacts and
 * the original statements merchants upload.
 *
 * Files live outside the web root on the deployment's persistent volume
 * (`/mnt/files` on Railway, the one volume the service has), under
 * `FINANCES_FILES_DIR`. Every object is encrypted at rest with AES-256-GCM
 * under a key derived for this purpose alone — `FINANCES_DOCUMENTS_KEY` when
 * set, otherwise HKDF over `ENCRYPTION_KEY` with a documents-only info
 * string — so a copied volume is ciphertext and the bank-credential key is
 * never the document key.
 *
 * Object keys are opaque `<kind>/<merchant>/<uuid>`; the merchant segment is
 * part of the key so a path can never be constructed for another tenant's
 * file, and the format is validated before it touches the filesystem.
 *
 * Writes are staged to a temporary name and renamed into place, so a crash
 * leaves either the whole file or none of it; `bytes` and `sha256` describe
 * the plaintext, which is what a download verifies.
 *
 * Merchant-sealed kinds (2026-10-28): statements, documents and provider
 * payloads are also sealed INSIDE the document-key layer to the merchant's
 * secrets vault public key, when they have a vault. Writing needs only the
 * public key, so imports and syncs keep storing while the merchant is away;
 * reading needs their unlock (VaultLockedError otherwise). Legacy objects of
 * a merchant who has a vault are re-sealed in place the first time they are
 * read while unlocked (and by the vault's legacy migration). Merchants with
 * no vault yet keep the old behaviour until LEGACY_KEY_MIGRATION=off.
 * Report artifacts are not sealed: they are re-rendered from the database and
 * served on accountant share links. 'bank-sessions' seal themselves
 * (bank-sessions.ts) and 'signing' belongs to e-signature documents that
 * third-party signers open.
 */

const MAGIC = Buffer.from('CPFD1');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export type ObjectKind = 'reports' | 'statements' | 'payloads' | 'documents' | 'bank-sessions' | 'signing';

export interface StoredObject {
  objectKey: string;
  bytes: number;
  sha256: string;
  keyVersion: number;
}

export function filesDir(): string {
  const configured = process.env.FINANCES_FILES_DIR?.trim();
  if (configured) return configured;
  if (existsSync('/mnt/files')) return '/mnt/files/finances';
  return path.join(process.cwd(), '.data', 'finances');
}

let cachedKey: Buffer | null = null;

function documentKey(): Buffer {
  if (cachedKey) return cachedKey;
  const explicit = process.env.FINANCES_DOCUMENTS_KEY?.trim();
  if (explicit) {
    if (!/^[0-9a-fA-F]{64}$/.test(explicit)) {
      throw new Error('FINANCES_DOCUMENTS_KEY must be 64 hex characters');
    }
    cachedKey = Buffer.from(explicit, 'hex');
    return cachedKey;
  }
  const master = requireEncryptionKey('finance document storage');
  cachedKey = Buffer.from(
    hkdfSync('sha256', Buffer.from(master, 'hex'), Buffer.alloc(0), 'coinpay-finance-documents-v1', 32),
  );
  return cachedKey;
}

/** Test seam. */
export function resetDocumentKey(): void {
  cachedKey = null;
}

const KEY_PATTERN = /^(reports|statements|payloads|documents|bank-sessions|signing)\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

function pathFor(objectKey: string): string {
  if (!KEY_PATTERN.test(objectKey)) throw new Error('Invalid object key');
  return path.join(filesDir(), ...objectKey.split('/')) + '.bin';
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function encryptBytes(plain: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', documentKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, ciphertext]);
}

export function decryptBytes(stored: Buffer): Buffer {
  if (stored.length < MAGIC.length + IV_LENGTH + TAG_LENGTH || !stored.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Stored object is not in the expected format');
  }
  const iv = stored.subarray(MAGIC.length, MAGIC.length + IV_LENGTH);
  const tag = stored.subarray(MAGIC.length + IV_LENGTH, MAGIC.length + IV_LENGTH + TAG_LENGTH);
  const ciphertext = stored.subarray(MAGIC.length + IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', documentKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Kinds sealed to the merchant's vault inside the document-key layer. */
export const MERCHANT_SEALED_KINDS: ReadonlySet<ObjectKind> = new Set<ObjectKind>(['statements', 'documents', 'payloads']);

function objectAad(objectKey: string): string {
  return `finance_files:${objectKey}`;
}

function parseKey(objectKey: string): { kind: ObjectKind; merchantId: string } {
  if (!KEY_PATTERN.test(objectKey)) throw new Error('Invalid object key');
  const [kind, merchantId] = objectKey.split('/');
  return { kind: kind as ObjectKind, merchantId };
}

async function writeAtomic(target: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const staging = `${target}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(staging, data, { mode: 0o600 });
    await rename(staging, target);
  } catch (err) {
    await rm(staging, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** The inner layer for an object: sealed to the merchant's vault when the kind calls for it and a vault exists. */
async function innerFor(objectKey: string, plain: Buffer): Promise<Buffer> {
  const { kind, merchantId } = parseKey(objectKey);
  if (!MERCHANT_SEALED_KINDS.has(kind)) return plain;
  if (!(await getVaultPublicKey('merchant', merchantId))) return plain;
  return Buffer.from(await sealBinaryFor('merchant', merchantId, plain, objectAad(objectKey)));
}

export async function putObject(kind: ObjectKind, merchantId: string, plain: Buffer): Promise<StoredObject> {
  const objectKey = `${kind}/${merchantId}/${randomUUID()}`;
  await writeAtomic(pathFor(objectKey), encryptBytes(await innerFor(objectKey, plain)));
  return { objectKey, bytes: plain.length, sha256: sha256Hex(plain), keyVersion: 1 };
}

export async function getObject(objectKey: string): Promise<Buffer> {
  const target = pathFor(objectKey);
  const inner = decryptBytes(await readFile(target));
  const { kind, merchantId } = parseKey(objectKey);
  if (isSealedBinary(inner)) {
    return Buffer.from(await openBinaryFor('merchant', merchantId, inner, objectAad(objectKey)));
  }
  if (!MERCHANT_SEALED_KINDS.has(kind)) return inner;
  // A legacy object. Without a vault the merchant has not adopted sealing yet:
  // readable until the cutoff. With one, it opens only while unlocked and is
  // re-sealed in place on the way out.
  if (!(await getVaultPublicKey('merchant', merchantId))) {
    if (!legacyKeyMigrationEnabled()) throw new Error('This file predates the secrets vault; set up your vault and upload it again');
    return inner;
  }
  if (!merchantUnlocked(merchantId)) throw new VaultLockedError('merchant');
  await writeAtomic(target, encryptBytes(await innerFor(objectKey, inner))).catch((err) =>
    console.error('[finance-files] re-seal failed', err instanceof Error ? err.message : err),
  );
  return inner;
}

/**
 * Re-seal one merchant's legacy objects to their vault in place. Needs only the
 * public key (no unlock). Returns how many objects were re-sealed.
 */
export async function resealLegacyObjects(merchantId: string): Promise<number> {
  if (!(await getVaultPublicKey('merchant', merchantId))) return 0;
  let count = 0;
  for (const kind of MERCHANT_SEALED_KINDS) {
    const dir = path.join(filesDir(), kind, merchantId);
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.bin')) continue;
      const objectKey = `${kind}/${merchantId}/${name.slice(0, -4)}`;
      if (!KEY_PATTERN.test(objectKey)) continue;
      const target = pathFor(objectKey);
      const inner = decryptBytes(await readFile(target));
      if (isSealedBinary(inner)) continue;
      await writeAtomic(target, encryptBytes(await innerFor(objectKey, inner)));
      count += 1;
    }
  }
  return count;
}

export async function objectExists(objectKey: string): Promise<boolean> {
  try {
    await stat(pathFor(objectKey));
    return true;
  } catch {
    return false;
  }
}

export async function deleteObject(objectKey: string): Promise<void> {
  await rm(pathFor(objectKey), { force: true });
}
