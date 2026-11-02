/**
 * sendTokenTransfers on EVM chains, the path escrow settle uses for
 * USDC_POL / USDC_ETH / USDC_BASE / USDT_*: every leg (beneficiary,
 * marketplace fee, CoinPay fee) must go out as an ERC-20 transfer of the
 * token contract, never as a native POL/ETH value transfer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  relay: vi.fn(),
  topUp: vi.fn(),
  contracts: [] as Array<{ address: string; transfers: Array<[string, bigint]> }>,
  nativeSends: [] as unknown[],
  key: Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(''),
}));

vi.mock('./evm-gas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./evm-gas')>();
  return { ...actual, forwardTokenViaRelayer: mocks.relay, ensureGasForTransfers: mocks.topUp };
});
vi.mock('./relayer-health', () => ({ alertRelayerUnderfunded: vi.fn() }));
vi.mock('@/lib/blockchain/providers', () => ({
  getProvider: () => ({ sendTransaction: (...a: unknown[]) => mocks.nativeSends.push(a) }),
  getRpcUrl: () => 'http://localhost',
  EthereumProvider: class {}, SolanaProvider: class {}, BitcoinProvider: class {},
}));
vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class FakeContract {
    private record: { address: string; transfers: Array<[string, bigint]> };
    constructor(address: string) {
      this.record = { address, transfers: [] };
      mocks.contracts.push(this.record);
    }
    async transfer(to: string, amount: bigint) {
      this.record.transfers.push([to, amount]);
      const hash = `0xtx${this.record.transfers.length}`;
      return { hash, wait: async () => ({ status: 1 }) };
    }
  }
  const ethers = { ...actual.ethers, Contract: FakeContract };
  return { ...actual, ethers, Contract: FakeContract };
});

import { sendTokenTransfers, ForwardNotStartedError } from './secure-forwarding';
import { RelayerUnderfundedError } from './evm-gas';

const USDC_POL_CONTRACT = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const BENEFICIARY = '0x' + '11'.repeat(20);
const MARKETPLACE = '0x' + '22'.repeat(20);
const COINPAY = '0x' + '33'.repeat(20);
const legs = [
  { address: BENEFICIARY, amount: 95.5 },
  { address: MARKETPLACE, amount: 3 },
  { address: COINPAY, amount: 1.5 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.contracts.length = 0;
  mocks.nativeSends.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('sendTokenTransfers on EVM (escrow settle legs)', () => {
  it('relays all three legs as the USDC_POL token in 6-decimal units', async () => {
    mocks.relay.mockResolvedValue({ relayerAddress: '0xrelayer', txHashes: ['0xa', '0xb', '0xc'], gasSpentWei: 0n });

    const hashes = await sendTokenTransfers('USDC_POL', 'http://localhost', mocks.key, legs);

    expect(hashes).toEqual(['0xa', '0xb', '0xc']);
    const call = mocks.relay.mock.calls[0][0];
    expect(call.tokenAddress).toBe(USDC_POL_CONTRACT);
    expect(call.recipients.map((r: { address: string; amount: bigint }) => [r.address, r.amount])).toEqual([
      [BENEFICIARY, 95_500_000n], [MARKETPLACE, 3_000_000n], [COINPAY, 1_500_000n],
    ]);
    expect(mocks.nativeSends).toHaveLength(0);
  });

  it('without a relayer permit, tops up gas then sends ERC-20 transfers, not native value', async () => {
    mocks.relay.mockResolvedValue(null);
    mocks.topUp.mockResolvedValue(null);

    const hashes = await sendTokenTransfers('USDC_POL', 'http://localhost', mocks.key, legs);

    expect(mocks.topUp).toHaveBeenCalledWith(expect.objectContaining({ cryptocurrency: 'USDC_POL', transferCount: 3 }));
    expect(mocks.contracts).toHaveLength(1);
    expect(mocks.contracts[0].address).toBe(USDC_POL_CONTRACT);
    expect(mocks.contracts[0].transfers).toEqual([
      [BENEFICIARY, 95_500_000n], [MARKETPLACE, 3_000_000n], [COINPAY, 1_500_000n],
    ]);
    expect(hashes).toEqual(['0xtx1', '0xtx2', '0xtx3']);
    expect(mocks.nativeSends).toHaveLength(0);
  });

  it('an empty relayer fails as retryable (ForwardNotStartedError) with nothing sent', async () => {
    mocks.relay.mockRejectedValue(new RelayerUnderfundedError({
      relayerAddress: '0xrelayer', cryptocurrency: 'USDC_POL', balanceWei: 0n, neededWei: 1n, purpose: 'for USDC_POL',
    }));

    await expect(sendTokenTransfers('USDC_POL', 'http://localhost', mocks.key, legs)).rejects.toBeInstanceOf(ForwardNotStartedError);
    expect(mocks.contracts.flatMap((c) => c.transfers)).toHaveLength(0);
    expect(mocks.nativeSends).toHaveLength(0);
  });

  it('skips a leg that rounds to zero token units', async () => {
    mocks.relay.mockResolvedValue({ relayerAddress: '0xrelayer', txHashes: ['0xa', '0xc'], gasSpentWei: 0n });

    const hashes = await sendTokenTransfers('USDC_ETH', 'http://localhost', mocks.key, [
      legs[0], { address: MARKETPLACE, amount: 0.0000001 }, legs[2],
    ]);

    expect(hashes).toEqual(['0xa', undefined, '0xc']);
    expect(mocks.relay.mock.calls[0][0].tokenAddress).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  });
});
