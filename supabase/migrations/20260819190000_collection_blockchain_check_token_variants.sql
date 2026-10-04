-- NEW-L5-1: bring `business_collection_payments_blockchain_check` up to date
-- with the chains the application actually supports.
--
-- The constraint was written on 2025-11-30 and never revisited. It allows the
-- eleven chains that existed then; `business-collection.ts` has since grown to
-- eighteen, and the seven token variants added since — USDT_ETH, USDT_POL,
-- USDT_SOL, USDC_ETH, USDC_POL, USDC_SOL, USDC_BASE — are all rejected at
-- INSERT. A merchant collecting in any of them gets a constraint violation from
-- a code path that believes the chain is supported, because `SUPPORTED_
-- BLOCKCHAINS` and this list were never the same list.
--
-- Verified before applying: production holds only ETH and BTC rows, so no
-- existing row can violate the new list and it can be validated immediately
-- rather than left NOT VALID.
--
-- The values below are exactly `SUPPORTED_BLOCKCHAINS` in
-- src/lib/payments/business-collection.ts. Keep them in step.

ALTER TABLE business_collection_payments
    DROP CONSTRAINT IF EXISTS business_collection_payments_blockchain_check;

ALTER TABLE business_collection_payments
    ADD CONSTRAINT business_collection_payments_blockchain_check
    CHECK (blockchain = ANY (ARRAY[
        'BTC', 'BCH', 'ETH', 'POL', 'SOL',
        'DOGE', 'XRP', 'ADA', 'BNB',
        'USDT', 'USDT_ETH', 'USDT_POL', 'USDT_SOL',
        'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_SOL', 'USDC_BASE'
    ]::text[]));
