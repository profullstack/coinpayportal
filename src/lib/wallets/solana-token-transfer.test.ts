/**
 * USDC/USDT on Solana: sendTokenTransfers builds one SPL transaction that
 * creates any missing recipient token account and moves the token, with the
 * CoinPay fee payer covering the fee and rent when it can.
 *
 * The RPC is faked; the keys, addresses and instruction encoding are real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import bs58 from 'bs58';
import { Keypair, PublicKey, type Transaction } from '@solana/web3.js';

const rpc = {
  existing: new Set<string>(),
  balances: new Map<string, number>(),
  rent: 2_039_280,
};
const sent: Array<{ tx: Transaction; signers: Keypair[] }> = [];
let feePayer: Keypair | null = null;

vi.mock('@solana/web3.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@solana/web3.js')>();
  class FakeConnection {
    async getTokenAccountsByOwner() {
      throw new Error('rate-limited on the public RPC; must not be called');
    }
    async getMultipleAccountsInfo(keys: PublicKey[]) {
      return keys.map((k) => (rpc.existing.has(k.toBase58()) ? { data: Buffer.alloc(165) } : null));
    }
    async getMinimumBalanceForRentExemption() {
      return rpc.rent;
    }
    async getBalance(key: PublicKey) {
      return rpc.balances.get(key.toBase58()) ?? 0;
    }
  }
  return {
    ...real,
    Connection: FakeConnection,
    sendAndConfirmTransaction: vi.fn(async (_c: unknown, tx: Transaction, signers: Keypair[]) => {
      sent.push({ tx, signers });
      return 'sim-signature';
    }),
  };
});

vi.mock('./system-wallet', async (importOriginal) => {
  const real = await importOriginal<typeof import('./system-wallet')>();
  return {
    ...real,
    deriveSolanaFeePayer: async () => {
      if (!feePayer) throw new Error('SYSTEM_MNEMONIC_SOL not set');
      return { address: feePayer.publicKey.toBase58(), privateKey: bs58.encode(feePayer.secretKey) };
    },
  };
});

const { sendTokenTransfers, SolanaFeeShortfallError, isTokenTransferChain } = await import('./secure-forwarding');

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

function ata(owner: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), new PublicKey(TOKEN_PROGRAM).toBuffer(), USDC_MINT.toBuffer()],
    new PublicKey(ATA_PROGRAM),
  )[0];
}

const escrow = Keypair.generate();
const escrowKey = bs58.encode(escrow.secretKey);
const beneficiary = Keypair.generate().publicKey;
const platform = Keypair.generate().publicKey;

beforeEach(() => {
  sent.length = 0;
  rpc.existing = new Set([ata(escrow.publicKey).toBase58()]);
  rpc.balances = new Map();
  feePayer = Keypair.generate();
});

describe('sendTokenTransfers on Solana', () => {
  it('uses the real associated-token program id', () => {
    // Mainnet: ATokenGPvbdGVxr1b2hv... The old 1Q2hv copy does not exist on chain.
    expect(ATA_PROGRAM).toBe('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  });

  it('fails before signing when the sending address has no token account', async () => {
    rpc.existing = new Set();
    rpc.balances.set(feePayer!.publicKey.toBase58(), 10_000_000);
    await expect(
      sendTokenTransfers('USDC_SOL', 'rpc://sol', escrowKey, [{ address: beneficiary.toBase58(), amount: 1 }]),
    ).rejects.toThrow(/No source USDC_SOL token account/);
    expect(sent).toHaveLength(0);
  });

  it('treats USDC and USDT chains as token chains, native coins not', () => {
    for (const chain of ['USDC_SOL', 'USDC_POL', 'USDC_ETH', 'USDC_BASE', 'USDT_SOL', 'USDT_POL'] as const) {
      expect(isTokenTransferChain(chain)).toBe(true);
    }
    for (const chain of ['SOL', 'ETH', 'POL', 'BTC'] as const) {
      expect(isTokenTransferChain(chain)).toBe(false);
    }
  });

  it('creates the recipient token account and sends SPL USDC, paid for by the fee payer', async () => {
    rpc.existing.add(ata(platform).toBase58());
    rpc.balances.set(feePayer!.publicKey.toBase58(), 10_000_000);

    const hashes = await sendTokenTransfers('USDC_SOL', 'rpc://sol', escrowKey, [
      { address: beneficiary.toBase58(), amount: 9.4 },
      { address: platform.toBase58(), amount: 0.1 },
    ]);

    expect(hashes).toEqual(['sim-signature', 'sim-signature']);
    expect(sent).toHaveLength(1);
    const { tx, signers } = sent[0];
    expect(tx.feePayer?.equals(feePayer!.publicKey)).toBe(true);
    expect(signers.map((s) => s.publicKey.toBase58()).sort()).toEqual(
      [feePayer!.publicKey.toBase58(), escrow.publicKey.toBase58()].sort(),
    );

    // create ATA (beneficiary only), transfer, transfer. No SystemProgram SOL transfer anywhere.
    expect(tx.instructions.map((ix) => ix.programId.toBase58())).toEqual([ATA_PROGRAM, TOKEN_PROGRAM, TOKEN_PROGRAM]);
    const [create, toBeneficiary, toPlatform] = tx.instructions;
    expect(create.keys[0].pubkey.equals(feePayer!.publicKey)).toBe(true); // rent payer
    expect(create.keys[1].pubkey.equals(ata(beneficiary))).toBe(true);
    expect(create.keys[2].pubkey.equals(beneficiary)).toBe(true);
    expect(create.keys[3].pubkey.equals(USDC_MINT)).toBe(true);

    expect(toBeneficiary.keys[0].pubkey.equals(ata(escrow.publicKey))).toBe(true);
    expect(toBeneficiary.keys[1].pubkey.equals(ata(beneficiary))).toBe(true);
    expect(toBeneficiary.keys[2].pubkey.equals(escrow.publicKey)).toBe(true);
    expect(toBeneficiary.data[0]).toBe(3); // SPL Transfer
    expect(toBeneficiary.data.readBigUInt64LE(1)).toBe(9_400_000n);
    expect(toPlatform.keys[1].pubkey.equals(ata(platform))).toBe(true);
    expect(toPlatform.data.readBigUInt64LE(1)).toBe(100_000n);
  });

  it('falls back to the deposit address paying when the fee payer is empty but the address has SOL', async () => {
    rpc.balances.set(escrow.publicKey.toBase58(), 5_000_000);

    await sendTokenTransfers('USDC_SOL', 'rpc://sol', escrowKey, [{ address: beneficiary.toBase58(), amount: 1 }]);

    const { tx, signers } = sent[0];
    expect(tx.feePayer?.equals(escrow.publicKey)).toBe(true);
    expect(signers).toHaveLength(1);
    expect(tx.instructions[0].keys[0].pubkey.equals(escrow.publicKey)).toBe(true);
  });

  it('throws SolanaFeeShortfallError before signing when nobody can pay the fee and rent', async () => {
    rpc.balances.set(feePayer!.publicKey.toBase58(), 1_000);

    const attempt = sendTokenTransfers('USDC_SOL', 'rpc://sol', escrowKey, [{ address: beneficiary.toBase58(), amount: 1 }]);
    await expect(attempt).rejects.toBeInstanceOf(SolanaFeeShortfallError);
    await expect(attempt).rejects.toThrow(feePayer!.publicKey.toBase58());
    expect(sent).toHaveLength(0);
  });

  it('needs only the fee, no rent, when every recipient already has a token account', async () => {
    rpc.existing.add(ata(beneficiary).toBase58());
    rpc.balances.set(feePayer!.publicKey.toBase58(), 10_000);

    await sendTokenTransfers('USDC_SOL', 'rpc://sol', escrowKey, [{ address: beneficiary.toBase58(), amount: 2.5 }]);

    expect(sent[0].tx.instructions.map((ix) => ix.programId.toBase58())).toEqual([TOKEN_PROGRAM]);
    expect(sent[0].tx.feePayer?.equals(feePayer!.publicKey)).toBe(true);
  });

  it('creates a shared token account once when two legs pay the same owner', async () => {
    rpc.balances.set(feePayer!.publicKey.toBase58(), 10_000_000);

    await sendTokenTransfers('USDC_SOL', 'rpc://sol', escrowKey, [
      { address: beneficiary.toBase58(), amount: 1 },
      { address: beneficiary.toBase58(), amount: 0.5 },
    ]);

    expect(sent[0].tx.instructions.map((ix) => ix.programId.toBase58())).toEqual([ATA_PROGRAM, TOKEN_PROGRAM, TOKEN_PROGRAM]);
  });

  it('works without a configured fee payer when the address holds SOL', async () => {
    feePayer = null;
    rpc.balances.set(escrow.publicKey.toBase58(), 5_000_000);

    await sendTokenTransfers('USDC_SOL', 'rpc://sol', escrowKey, [{ address: beneficiary.toBase58(), amount: 1 }]);
    expect(sent[0].tx.feePayer?.equals(escrow.publicKey)).toBe(true);
  });

  it('leaves a leg that rounds to zero units unsent', async () => {
    rpc.existing.add(ata(beneficiary).toBase58());
    rpc.balances.set(feePayer!.publicKey.toBase58(), 10_000_000);

    const hashes = await sendTokenTransfers('USDC_SOL', 'rpc://sol', escrowKey, [
      { address: beneficiary.toBase58(), amount: 1 },
      { address: platform.toBase58(), amount: 0.0000001 },
    ]);
    expect(hashes).toEqual(['sim-signature', undefined]);
    expect(sent[0].tx.instructions).toHaveLength(1);
  });
});
