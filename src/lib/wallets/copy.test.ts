import { describe, expect, it } from 'vitest';
import { formatWalletAddressCopyText } from './copy';

describe('formatWalletAddressCopyText', () => {
  const wallets = [
    {
      cryptocurrency: 'BTC',
      wallet_address: 'bc1qexample',
      label: 'Treasury',
    },
    {
      cryptocurrency: 'ETH',
      wallet_address: '0x1234',
      label: null,
    },
  ];

  it('includes extra fields when requested', () => {
    expect(formatWalletAddressCopyText(wallets, true)).toBe(
      'BTC (Treasury): bc1qexample\nETH: 0x1234'
    );
  });

  it('reduces output to coin and address when includeAllFields is false', () => {
    expect(formatWalletAddressCopyText(wallets, false)).toBe(
      'BTC: bc1qexample\nETH: 0x1234'
    );
  });
});
