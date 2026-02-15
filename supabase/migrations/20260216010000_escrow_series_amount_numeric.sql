-- Change escrow_series.amount from bigint to numeric
-- to match escrows.amount and support crypto decimal amounts (e.g. 0.00058 BTC)
ALTER TABLE escrow_series ALTER COLUMN amount TYPE numeric USING amount::numeric;
