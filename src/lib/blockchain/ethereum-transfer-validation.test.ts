import { ethers } from 'ethers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EthereumProvider } from './providers';

// Synthetic signing fixture only; no network or funded account is used.
const privateKey = '0x' + '11'.repeat(32);
const from = new ethers.Wallet(privateKey).address;
const merchant = ethers.getAddress('0x' + '22'.repeat(20));
const fee = ethers.getAddress('0x' + '33'.repeat(20));
let provider: EthereumProvider;
let balance: ReturnType<typeof vi.spyOn>;
let send: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  balance = vi.spyOn(ethers.JsonRpcProvider.prototype, 'getBalance').mockResolvedValue(ethers.parseEther('10'));
  vi.spyOn(ethers.JsonRpcProvider.prototype, 'getFeeData').mockResolvedValue(new ethers.FeeData(1_000_000_000n, null, null));
  vi.spyOn(ethers.JsonRpcProvider.prototype, 'send').mockRejectedValue(new Error('External RPC prohibited in unit test'));
  send = vi.spyOn(ethers.Wallet.prototype, 'sendTransaction').mockResolvedValue({
    hash: 'synthetic-hash', wait: vi.fn().mockResolvedValue({ status: 1 }),
  } as unknown as ethers.TransactionResponse);
  provider = new EthereumProvider('http://127.0.0.1:1');
});
afterEach(() => {
  (provider as unknown as { provider: ethers.JsonRpcProvider }).provider.destroy();
  vi.restoreAllMocks();
});

describe('Ethereum native transfer validation before side effects', () => {
  it.each(['single', 'split'])('rejects signer/from mismatch for %s transfer', async mode => {
    const result = mode === 'single' ? provider.sendTransaction(fee, merchant, '1', privateKey)
      : provider.sendSplitTransaction(fee, [{ address: merchant, amount: '1' }], privateKey);
    await expect(result).rejects.toThrow(/sign|match/i);
    expect(balance).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it.each(['-1', '0', 'NaN', 'Infinity', '1e-3', '0.0000000000000000001'])('rejects invalid single amount %s before RPC', async amount => {
    await expect(provider.sendTransaction(from, merchant, amount, privateKey)).rejects.toThrow();
    expect(balance).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it.each(['-1', '0', 'NaN', 'Infinity', '0.0000000000000000001'])('validates later split amount %s before sending the first leg', async amount => {
    await expect(provider.sendSplitTransaction(from, [
      { address: merchant, amount: '1' }, { address: fee, amount },
    ], privateKey)).rejects.toThrow();
    expect(balance).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it('rejects a negative first leg instead of sending only the fee', async () => {
    await expect(provider.sendSplitTransaction(from, [
      { address: merchant, amount: '-1' }, { address: fee, amount: '0.01' },
    ], privateKey)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects an empty recipient list', async () => {
    await expect(provider.sendSplitTransaction(from, [], privateKey)).rejects.toThrow();
    expect(balance).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it('validates every destination before the first split leg', async () => {
    await expect(provider.sendSplitTransaction(from, [
      { address: merchant, amount: '1' }, { address: 'not-an-address', amount: '0.01' },
    ], privateKey)).rejects.toThrow();
    expect(balance).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it('rejects invalid single destination before RPC', async () => {
    await expect(provider.sendTransaction(from, 'not-an-address', '1', privateKey)).rejects.toThrow();
    expect(balance).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it('accepts the same sender in lowercase and a positive one-wei transfer', async () => {
    await expect(provider.sendTransaction(from.toLowerCase(), merchant, '0.000000000000000001', privateKey)).resolves.toBe('synthetic-hash');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: merchant, value: 1n }));
  });

  it('preserves valid split amounts and recipients', async () => {
    await expect(provider.sendSplitTransaction(from.toLowerCase(), [
      { address: merchant, amount: '0.99' }, { address: fee, amount: '0.01' },
    ], privateKey)).resolves.toBe('synthetic-hash');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, expect.objectContaining({ to: merchant, value: ethers.parseEther('0.99') }));
    expect(send).toHaveBeenNthCalledWith(2, expect.objectContaining({ to: fee, value: ethers.parseEther('0.01') }));
  });
});
