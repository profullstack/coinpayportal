import { describe, it, expect } from 'vitest';
import { isValidPayoutAddress } from './address-format';

describe('isValidPayoutAddress', () => {
  // Real addresses observed in production.
  const SOL = 'FX8QhU1TPUHGs2X8PibbHikd4YvdQMPfVuFd6mqk9qJw';
  const EVM = '0x1234567890abcdef1234567890abcdef12345678';
  const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

  it('validates Solana addresses for SOL and SOL-based tokens', () => {
    expect(isValidPayoutAddress(SOL, 'SOL')).toBe(true);
    expect(isValidPayoutAddress(SOL, 'USDC_SOL')).toBe(true);
    expect(isValidPayoutAddress(SOL, 'USDT_SOL')).toBe(true);
    // Bare USDC defaults to the Solana rail.
    expect(isValidPayoutAddress(SOL, 'USDC')).toBe(true);
  });

  it('validates EVM addresses for ETH/POL and their token variants', () => {
    expect(isValidPayoutAddress(EVM, 'ETH')).toBe(true);
    expect(isValidPayoutAddress(EVM, 'POL')).toBe(true);
    expect(isValidPayoutAddress(EVM, 'USDC_ETH')).toBe(true);
    expect(isValidPayoutAddress(EVM, 'USDT_POL')).toBe(true);
    // Bare USDT defaults to the EVM rail.
    expect(isValidPayoutAddress(EVM, 'USDT')).toBe(true);
  });

  it('validates BTC addresses', () => {
    expect(isValidPayoutAddress(BTC, 'BTC')).toBe(true);
  });

  it('rejects an address used on the wrong chain', () => {
    expect(isValidPayoutAddress(EVM, 'SOL')).toBe(false);
    expect(isValidPayoutAddress(SOL, 'ETH')).toBe(false);
    expect(isValidPayoutAddress('0xshort', 'ETH')).toBe(false);
    expect(isValidPayoutAddress('', 'SOL')).toBe(false);
  });

  it('returns null (skip validation) for chains we have no validator for', () => {
    expect(isValidPayoutAddress('whatever', 'DOGE')).toBeNull();
    expect(isValidPayoutAddress('whatever', 'XRP')).toBeNull();
    expect(isValidPayoutAddress('whatever', 'ADA')).toBeNull();
  });
});
