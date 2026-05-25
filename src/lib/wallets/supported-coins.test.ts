import { describe, expect, it } from 'vitest';
import {
  coinToSupportedToken,
  parseTokenSymbol,
  walletToSupportedCoin,
  type WalletRecord,
} from './supported-coins';

describe('supported coin wallet helpers', () => {
  it('marks business wallets as business sourced coins', () => {
    const wallet: WalletRecord = {
      cryptocurrency: 'USDC_POL',
      wallet_address: '0xabc',
      is_active: true,
      source: 'business',
    };

    expect(walletToSupportedCoin(wallet)).toEqual({
      symbol: 'USDC_POL',
      name: 'USD Coin (Polygon)',
      is_active: true,
      has_wallet: true,
      wallet_source: 'business',
    });
  });

  it('marks merchant global fallback wallets explicitly', () => {
    const wallet: WalletRecord = {
      cryptocurrency: 'BTC',
      wallet_address: 'bc1q...',
      is_active: true,
      source: 'merchant_global',
    };

    expect(walletToSupportedCoin(wallet)).toMatchObject({
      symbol: 'BTC',
      name: 'Bitcoin',
      wallet_source: 'merchant_global',
    });
  });

  it('normalizes coin records into payment token records', () => {
    const token = coinToSupportedToken({
      symbol: 'USDC_POL',
      name: 'USD Coin (Polygon)',
      is_active: true,
      has_wallet: true,
      wallet_source: 'merchant_global',
    });

    expect(token).toEqual({
      symbol: 'USDC_POL',
      code: 'usdc_pol',
      ticker: 'USDC',
      chain: 'Polygon',
      name: 'USD Coin (Polygon)',
      is_active: true,
      has_wallet: true,
      wallet_source: 'merchant_global',
    });
  });

  it('parses chain-specific and native token symbols', () => {
    expect(parseTokenSymbol('USDT_SOL')).toEqual({ ticker: 'USDT', chain: 'Solana' });
    expect(parseTokenSymbol('BTC')).toEqual({ ticker: 'BTC', chain: undefined });
  });
});
