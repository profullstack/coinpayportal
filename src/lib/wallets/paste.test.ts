import { describe, it, expect } from 'vitest';
import { parseWalletPasteText } from './paste';

describe('parseWalletPasteText', () => {
  it('parses supported wallet lines', () => {
    const result = parseWalletPasteText(`
BTC: 165y3LYwtbPythyYDKU1DzReT7E74tZGMh
USDT_SOL: FX8QhU1TPUHGs2X8PibbHikd4YvdQMPfVuFd6mqk9qJw
USDC_POL: 0xEf993488b444b75585A5CCe171e65F4dD9D99add
    `);

    expect(result.wallets).toEqual([
      {
        cryptocurrency: 'BTC',
        wallet_address: '165y3LYwtbPythyYDKU1DzReT7E74tZGMh',
      },
      {
        cryptocurrency: 'USDT_SOL',
        wallet_address: 'FX8QhU1TPUHGs2X8PibbHikd4YvdQMPfVuFd6mqk9qJw',
      },
      {
        cryptocurrency: 'USDC_POL',
        wallet_address: '0xEf993488b444b75585A5CCe171e65F4dD9D99add',
      },
    ]);
    expect(result.invalidLines).toEqual([]);
    expect(result.unsupportedCryptocurrencies).toEqual([]);
  });

  it('keeps the last duplicate value and reports invalid or unsupported lines', () => {
    const result = parseWalletPasteText(`
BTC: first
BAD LINE
USDT_TRON: T123
BTC: second
    `);

    expect(result.wallets).toEqual([
      {
        cryptocurrency: 'BTC',
        wallet_address: 'second',
      },
    ]);
    expect(result.invalidLines).toEqual(['BAD LINE']);
    expect(result.unsupportedCryptocurrencies).toEqual(['USDT_TRON']);
    expect(result.duplicateCryptocurrencies).toEqual(['BTC']);
  });
});
