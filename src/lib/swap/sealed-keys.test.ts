import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomBytes } from 'crypto';
import { secp256k1 } from '@noble/curves/secp256k1';
import { encrypt } from '@/lib/crypto/encryption';
import { isSealed, openWithWalletKey, sealToWalletKey, swapKeyAad, SWAP_SEAL_VERSION } from './sealed-keys';
import {
  hasLegacyProviderSecrets,
  resealLegacyProviderSecrets,
  sealProviderSecrets,
} from './legacy-reseal';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

function walletKeys() {
  const priv = secp256k1.utils.randomSecretKey();
  return { priv: hex(priv), pub: hex(secp256k1.getPublicKey(priv, true)) };
}

const SECRET = 'a'.repeat(30) + 'b1c2d3e4f5a6b7c8d9e0f1a2b3c4'; // 58 hex-ish chars, not a real key

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sealToWalletKey / openWithWalletKey', () => {
  it('round-trips with the wallet key and the same AAD', async () => {
    const w = walletKeys();
    const aad = swapKeyAad('w1', 's1', 'refundPrivateKey');
    const sealed = await sealToWalletKey(w.pub, SECRET, aad);
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain(SECRET);
    expect(await openWithWalletKey(w.priv, sealed, aad)).toBe(SECRET);
  });

  it('two seals of the same value differ (fresh ephemeral key + IV)', async () => {
    const w = walletKeys();
    const a = await sealToWalletKey(w.pub, SECRET, 'x');
    const b = await sealToWalletKey(w.pub, SECRET, 'x');
    expect(a).not.toBe(b);
  });

  it('fails with another wallet key', async () => {
    const w = walletKeys();
    const other = walletKeys();
    const sealed = await sealToWalletKey(w.pub, SECRET, 'aad');
    await expect(openWithWalletKey(other.priv, sealed, 'aad')).rejects.toThrow();
  });

  it('fails when the AAD (wallet, swap or field) differs', async () => {
    const w = walletKeys();
    const sealed = await sealToWalletKey(w.pub, SECRET, swapKeyAad('w1', 's1', 'refundPrivateKey'));
    await expect(openWithWalletKey(w.priv, sealed, swapKeyAad('w2', 's1', 'refundPrivateKey'))).rejects.toThrow();
    await expect(openWithWalletKey(w.priv, sealed, swapKeyAad('w1', 's2', 'refundPrivateKey'))).rejects.toThrow();
    await expect(openWithWalletKey(w.priv, sealed, swapKeyAad('w1', 's1', 'claimPrivateKey'))).rejects.toThrow();
  });

  it('fails on a tampered ciphertext', async () => {
    const w = walletKeys();
    const sealed = await sealToWalletKey(w.pub, SECRET, 'aad');
    const flipped = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'B' : 'A') + sealed.slice(-1);
    await expect(openWithWalletKey(w.priv, flipped, 'aad')).rejects.toThrow();
  });

  it('rejects an invalid wallet public key', async () => {
    await expect(sealToWalletKey('02' + '00'.repeat(32), SECRET, 'aad')).rejects.toThrow();
    await expect(sealToWalletKey('not-hex', SECRET, 'aad')).rejects.toThrow();
  });
});

describe('sealProviderSecrets: no server key involved', () => {
  it('seals with ENCRYPTION_KEY unset (no env fallback) and never keeps plaintext', async () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    const w = walletKeys();
    const out = await sealProviderSecrets(
      { direction: 'in', refundPrivateKey: SECRET, bip21: 'bitcoin:x' },
      { walletId: 'w1', swapId: 's1', walletPublicKey: w.pub }
    );
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(out.bip21).toBe('bitcoin:x');
    expect(await openWithWalletKey(w.priv, out.refundPrivateKey as string, swapKeyAad('w1', 's1', 'refundPrivateKey'))).toBe(SECRET);
    expect(hasLegacyProviderSecrets(out)).toBe(false);
  });

  it('leaves provider_data without key material untouched (client-held key)', async () => {
    const out = await sealProviderSecrets({ direction: 'out', invoice: 'lnbc1' }, { walletId: 'w', swapId: 's', walletPublicKey: '' });
    expect(out).toEqual({ direction: 'out', invoice: 'lnbc1' });
  });
});

describe('resealLegacyProviderSecrets (one-shot migration)', () => {
  const legacyKey = randomBytes(32).toString('hex');

  it('opens an enc: blob under the legacy key and re-seals it to the wallet', async () => {
    vi.stubEnv('ENCRYPTION_KEY', legacyKey);
    const w = walletKeys();
    const legacy = { direction: 'out', claimPrivateKey: `enc:${encrypt(SECRET, legacyKey)}` };
    expect(hasLegacyProviderSecrets(legacy)).toBe(true);
    const r = await resealLegacyProviderSecrets(legacy, { walletId: 'w1', swapId: 's1', walletPublicKey: w.pub });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    expect(r.providerData.seal_version).toBe(SWAP_SEAL_VERSION);
    expect(JSON.stringify(r.providerData)).not.toContain('enc:');
    expect(hasLegacyProviderSecrets(r.providerData)).toBe(false);
    // The re-sealed value no longer depends on ENCRYPTION_KEY.
    vi.stubEnv('ENCRYPTION_KEY', '');
    expect(
      await openWithWalletKey(w.priv, r.providerData.claimPrivateKey as string, swapKeyAad('w1', 's1', 'claimPrivateKey'))
    ).toBe(SECRET);
  });

  it('re-seals a pre-encryption plaintext value without needing any key', async () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    const w = walletKeys();
    const r = await resealLegacyProviderSecrets({ refundPrivateKey: SECRET }, { walletId: 'w', swapId: 's', walletPublicKey: w.pub });
    expect(r.ok && r.changed).toBe(true);
    if (r.ok) expect(JSON.stringify(r.providerData)).not.toContain(SECRET);
  });

  it('refuses enc: blobs once LEGACY_KEY_MIGRATION=off, and keeps the data', async () => {
    vi.stubEnv('ENCRYPTION_KEY', legacyKey);
    vi.stubEnv('LEGACY_KEY_MIGRATION', 'off');
    const w = walletKeys();
    const legacy = { refundPrivateKey: `enc:${encrypt(SECRET, legacyKey)}` };
    const r = await resealLegacyProviderSecrets(legacy, { walletId: 'w', swapId: 's', walletPublicKey: w.pub });
    expect(r.ok).toBe(false);
    expect(legacy.refundPrivateKey.startsWith('enc:')).toBe(true);
  });

  it('is a no-op on an already sealed row', async () => {
    const w = walletKeys();
    const sealed = await sealProviderSecrets({ refundPrivateKey: SECRET }, { walletId: 'w', swapId: 's', walletPublicKey: w.pub });
    const r = await resealLegacyProviderSecrets(sealed, { walletId: 'w', swapId: 's', walletPublicKey: w.pub });
    expect(r.ok && !r.changed).toBe(true);
  });
});
