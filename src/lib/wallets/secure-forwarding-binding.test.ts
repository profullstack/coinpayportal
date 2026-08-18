import { describe, expect, it } from 'vitest';
import { validateForwardingBinding } from './secure-forwarding';

const PAYMENT = {
  id: 'payment-123',
  blockchain: 'SOL',
  payment_address: 'source-address',
  merchant_wallet_address: 'merchant-address',
};

const ADDRESS_RECORD = {
  payment_id: 'payment-123',
  cryptocurrency: 'SOL' as const,
  address: 'source-address',
  merchant_wallet: 'merchant-address',
  commission_wallet: 'commission-address',
};

const COMMISSION_WALLET = 'commission-address';

describe('validateForwardingBinding', () => {
  it('accepts matching payment and signing records', () => {
    expect(
      validateForwardingBinding(PAYMENT, ADDRESS_RECORD, COMMISSION_WALLET)
    ).toBeNull();
  });

  it('accepts surrounding whitespace in recorded addresses', () => {
    expect(
      validateForwardingBinding(
        PAYMENT,
        {
          ...ADDRESS_RECORD,
          address: ' source-address ',
          merchant_wallet: ' merchant-address ',
          commission_wallet: ' commission-address ',
        },
        COMMISSION_WALLET
      )
    ).toBeNull();
  });

  it('rejects a payment-id mismatch', () => {
    expect(
      validateForwardingBinding(
        PAYMENT,
        { ...ADDRESS_RECORD, payment_id: 'other-payment' },
        COMMISSION_WALLET
      )
    ).toBe('Payment address record belongs to a different payment');
  });

  it('rejects a missing source address', () => {
    expect(
      validateForwardingBinding(
        { ...PAYMENT, payment_address: null },
        ADDRESS_RECORD,
        COMMISSION_WALLET
      )
    ).toBe('Payment has no recorded source address');
  });

  it('rejects a source-address mismatch', () => {
    expect(
      validateForwardingBinding(
        PAYMENT,
        { ...ADDRESS_RECORD, address: 'other-source' },
        COMMISSION_WALLET
      )
    ).toBe('Payment source address does not match its signing record');
  });

  it('rejects a missing blockchain', () => {
    expect(
      validateForwardingBinding(
        { ...PAYMENT, blockchain: null },
        ADDRESS_RECORD,
        COMMISSION_WALLET
      )
    ).toBe('Payment has no recorded blockchain');
  });

  it('rejects a merchant-address mismatch', () => {
    expect(
      validateForwardingBinding(
        PAYMENT,
        { ...ADDRESS_RECORD, merchant_wallet: 'other-merchant' },
        COMMISSION_WALLET
      )
    ).toBe('Merchant payout address does not match its signing record');
  });

  it('rejects a missing merchant address', () => {
    expect(
      validateForwardingBinding(
        { ...PAYMENT, merchant_wallet_address: null },
        ADDRESS_RECORD,
        COMMISSION_WALLET
      )
    ).toBe('Payment has no recorded merchant payout address');
  });

  it('rejects a blockchain mismatch', () => {
    expect(
      validateForwardingBinding(
        PAYMENT,
        { ...ADDRESS_RECORD, cryptocurrency: 'BTC' },
        COMMISSION_WALLET
      )
    ).toBe('Payment blockchain does not match its signing record');
  });

  it('rejects a missing platform fee wallet', () => {
    expect(
      validateForwardingBinding(
        PAYMENT,
        { ...ADDRESS_RECORD, commission_wallet: ' ' },
        COMMISSION_WALLET
      )
    ).toBe('Payment signing record has no platform fee wallet');
  });

  it('rejects a platform fee wallet that differs from server configuration', () => {
    expect(
      validateForwardingBinding(PAYMENT, ADDRESS_RECORD, 'other-commission-address')
    ).toBe('Platform fee wallet does not match server configuration');
  });

  it('compares EVM addresses case-insensitively', () => {
    expect(
      validateForwardingBinding(
        {
          ...PAYMENT,
          blockchain: 'ETH',
          payment_address: '0xAbCd',
          merchant_wallet_address: '0xEf01',
        },
        {
          ...ADDRESS_RECORD,
          cryptocurrency: 'ETH',
          address: '0xabcd',
          merchant_wallet: '0xef01',
          commission_wallet: '0xab02',
        },
        '0xAb02'
      )
    ).toBeNull();
  });
});
