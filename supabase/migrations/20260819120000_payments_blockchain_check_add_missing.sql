-- NEW-L5-2 (2026-08-19 audit): payments.blockchain CHECK omits three values the
-- application inserts.
--
-- `blockchainSchema` in src/lib/payments/service.ts accepts 'USDT', 'USDC' and
-- 'USDC_BASE', and `supportedBlockchains` in the same file generates payment
-- addresses for all three, but the constraint permitted none of them. Payment
-- creation for those currencies therefore failed outright in the primary flow —
-- the row was rejected by Postgres, not by any validation the caller could see.
--
-- Widening a CHECK is safe against existing rows: every stored value already
-- satisfies the narrower list, so this validates without a table rewrite of
-- anything that would fail.
--
-- MATIC and USDC_MATIC are retained. Nothing in the application emits them any
-- more, but rows may exist from before the POL rename and dropping them from the
-- constraint would invalidate history for no benefit.

alter table public.payments
  drop constraint if exists payments_blockchain_check;

alter table public.payments
  add constraint payments_blockchain_check check (
    blockchain = any (array[
      'BTC', 'BCH', 'ETH', 'POL', 'SOL',
      'DOGE', 'XRP', 'ADA', 'BNB',
      'USDT', 'USDT_ETH', 'USDT_POL', 'USDT_SOL',
      'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_SOL', 'USDC_BASE',
      -- legacy, pre-POL-rename
      'MATIC', 'USDC_MATIC'
    ])
  );
