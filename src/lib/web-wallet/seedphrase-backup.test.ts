import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as openpgp from 'openpgp';

// Captured data from the mock Blob
let capturedBlobData: Uint8Array | null = null;
let capturedFilename: string | null = null;

// Mock browser globals needed by triggerDownload
beforeEach(() => {
  capturedBlobData = null;
  capturedFilename = null;

  // Mock Blob — capture the data passed to it
  global.Blob = class MockBlob {
    _data: Uint8Array;
    constructor(parts: any[], _opts?: any) {
      // parts[0] is the Uint8Array
      this._data = parts[0] instanceof Uint8Array ? parts[0] : new Uint8Array(parts[0]);
      capturedBlobData = this._data;
    }
    async arrayBuffer() {
      return this._data.buffer;
    }
  } as any;

  // Mock URL
  global.URL = {
    createObjectURL: vi.fn().mockReturnValue('blob:mock-url'),
    revokeObjectURL: vi.fn(),
  } as any;

  // Mock document
  const mockAnchor: any = {
    href: '',
    download: '',
    style: { display: '' },
    click: vi.fn(),
  };

  global.document = {
    createElement: vi.fn().mockReturnValue(mockAnchor),
    body: {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    },
  } as any;

  // We'll capture the filename from the anchor's download property after the call
  const origClick = mockAnchor.click;
  mockAnchor.click = vi.fn(() => {
    capturedFilename = mockAnchor.download;
    origClick();
  });
});

import { downloadEncryptedSeedPhrase } from './seedphrase-backup';

describe('seedphrase-backup (web UI)', () => {
  const testMnemonic =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const testPassword = 'Str0ng!P@ssword';
  const testWalletId = 'wid-abc-123';

  it('should trigger a download with the correct filename', async () => {
    await downloadEncryptedSeedPhrase(testMnemonic, testPassword, testWalletId);

    expect(capturedFilename).toBe(`wallet_${testWalletId}_seedphrase.txt.gpg`);
    expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('should produce valid OpenPGP binary output that can be decrypted', async () => {
    await downloadEncryptedSeedPhrase(testMnemonic, testPassword, testWalletId);

    expect(capturedBlobData).not.toBeNull();
    expect(capturedBlobData!.length).toBeGreaterThan(0);

    // Decrypt with openpgp
    const message = await openpgp.readMessage({ binaryMessage: capturedBlobData! });
    const { data } = await openpgp.decrypt({
      message,
      passwords: [testPassword],
    });

    expect(data).toContain(testMnemonic);
  });

  it('should include wallet ID and header comments in decrypted content', async () => {
    await downloadEncryptedSeedPhrase(testMnemonic, testPassword, testWalletId);

    const message = await openpgp.readMessage({ binaryMessage: capturedBlobData! });
    const { data } = await openpgp.decrypt({
      message,
      passwords: [testPassword],
    });

    const text = data as string;
    expect(text).toContain('# CoinPayPortal Wallet Seed Phrase Backup');
    expect(text).toContain(`# Wallet ID: ${testWalletId}`);
    expect(text).toContain('KEEP THIS FILE SAFE');
    expect(text).toContain('gpg --decrypt');
  });

  it('should fail to decrypt with a wrong password', async () => {
    await downloadEncryptedSeedPhrase(testMnemonic, testPassword, testWalletId);

    const message = await openpgp.readMessage({ binaryMessage: capturedBlobData! });

    await expect(
      openpgp.decrypt({ message, passwords: ['wrong-password'] })
    ).rejects.toThrow();
  });

  it('should produce different ciphertexts for different passwords', async () => {
    await downloadEncryptedSeedPhrase(testMnemonic, 'password-A', testWalletId);
    const data1 = new Uint8Array(capturedBlobData!);

    await downloadEncryptedSeedPhrase(testMnemonic, 'password-B', testWalletId);
    const data2 = new Uint8Array(capturedBlobData!);

    // Convert to hex for comparison
    const hex1 = Array.from(data1).map((b) => b.toString(16).padStart(2, '0')).join('');
    const hex2 = Array.from(data2).map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex1).not.toBe(hex2);
  });
});
