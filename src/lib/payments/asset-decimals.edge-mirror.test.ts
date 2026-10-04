import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assetDecimals, atomicUnit, DEFAULT_QUOTE_DECIMALS } from './asset-decimals';

/**
 * The Supabase edge function is one of the schedulers that confirms payments, and
 * it cannot import from the app — it is a separate Deno deployable, so it carries
 * its own copy of the decimals table. A copy that drifts is worse than no copy:
 * the settlement verdict would then depend on which worker looked at the row
 * first, which is exactly the kind of bug that took a day to find the first time.
 *
 * Read both tables out of the source and compare them. This is a text comparison
 * on purpose — the edge function imports `esm.sh` and uses Deno globals, so it
 * cannot be imported here.
 */
const EDGE_FUNCTION = join(
  process.cwd(),
  'supabase/functions/monitor-payments/index.ts'
);

function parseDecimalsTable(source: string, declaration: string): Record<string, number> {
  const start = source.indexOf(declaration);
  if (start === -1) throw new Error(`no ${declaration} found`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('};', open);
  if (open === -1 || close === -1) throw new Error(`could not bound ${declaration}`);

  const table: Record<string, number> = {};
  for (const [, asset, decimals] of source
    .slice(open, close)
    .matchAll(/^\s*([A-Z0-9_]+)\s*:\s*(\d+)\s*,/gm)) {
    table[asset] = Number(decimals);
  }
  if (Object.keys(table).length === 0) throw new Error(`${declaration} parsed empty`);
  return table;
}

describe('the edge function mirrors the app decimals table', () => {
  const appSource = readFileSync(join(process.cwd(), 'src/lib/payments/asset-decimals.ts'), 'utf8');
  const edgeSource = readFileSync(EDGE_FUNCTION, 'utf8');

  const appTable = parseDecimalsTable(appSource, 'const ASSET_DECIMALS');
  const edgeTable = parseDecimalsTable(edgeSource, 'const ASSET_DECIMALS');

  it('covers exactly the same assets', () => {
    expect(Object.keys(edgeTable).sort()).toEqual(Object.keys(appTable).sort());
  });

  it('agrees on every asset precision', () => {
    expect(edgeTable).toEqual(appTable);
  });

  it('agrees on the fallback for an unknown asset', () => {
    expect(edgeSource).toContain(`const DEFAULT_QUOTE_DECIMALS = ${DEFAULT_QUOTE_DECIMALS}`);
  });

  it('floors the settlement comparison at one atomic unit', () => {
    // The whole point of the mirror: the edge function must widen its epsilon the
    // same way the app does, or it alone still refuses a payable amount.
    expect(edgeSource).toContain(
      'Math.max(expectedAmount * 1e-9, atomicUnit(payment.blockchain))'
    );
  });

  it('parsed a table that matches the exported helpers', () => {
    // Guards the parser itself: a regex that silently matched nothing would make
    // every assertion above vacuous.
    expect(appTable.USDC_ETH).toBe(6);
    expect(appTable.BTC).toBe(8);
    expect(assetDecimals('USDC_ETH')).toBe(appTable.USDC_ETH);
    expect(atomicUnit('USDC_ETH')).toBe(1e-6);
  });
});
