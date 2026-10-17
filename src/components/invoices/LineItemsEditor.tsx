'use client';

import Link from 'next/link';
import { computeInvoiceTotals, LineItemError, taxSummary, type InvoiceTotals } from '@/lib/invoices/line-items';

export interface TaxRate {
  id: string;
  name: string;
  rate: number;
  is_default: boolean;
}

export interface CatalogItem {
  id: string;
  name: string;
  description: string | null;
  unit_price: number;
  unit: string | null;
  tax_rate_id: string | null;
}

/** One editable row; numbers stay strings until submit so typing is not fought. */
export interface DraftLine {
  item_id: string | null;
  description: string;
  quantity: string;
  unit_price: string;
  tax_rate_id: string;
}

export interface DraftDiscount {
  type: 'percent' | 'fixed';
  value: string;
}

export const emptyLine = (taxRateId = ''): DraftLine => ({
  item_id: null,
  description: '',
  quantity: '1',
  unit_price: '',
  tax_rate_id: taxRateId,
});

/** Convert draft rows to the API's line_items / discount, or explain why not. */
export function toApiLines(lines: DraftLine[], taxRates: TaxRate[], discount: DraftDiscount) {
  const line_items = lines.map((l) => {
    const rate = taxRates.find((t) => t.id === l.tax_rate_id);
    return {
      item_id: l.item_id,
      description: l.description.trim(),
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      tax_rate: rate ? Number(rate.rate) : null,
      tax_name: rate ? rate.name : null,
    };
  });
  const value = Number(discount.value);
  return {
    line_items,
    discount: discount.value.trim() && value > 0 ? { type: discount.type, value } : null,
  };
}

export function previewTotals(
  lines: DraftLine[],
  taxRates: TaxRate[],
  discount: DraftDiscount
): { totals: InvoiceTotals | null; error: string | null } {
  try {
    const api = toApiLines(lines, taxRates, discount);
    return { totals: computeInvoiceTotals(api.line_items, api.discount), error: null };
  } catch (err) {
    return { totals: null, error: err instanceof LineItemError ? err.message : 'Invalid line items' };
  }
}

interface Props {
  lines: DraftLine[];
  onLinesChange: (lines: DraftLine[]) => void;
  discount: DraftDiscount;
  onDiscountChange: (d: DraftDiscount) => void;
  taxRates: TaxRate[];
  catalog: CatalogItem[];
  currency: string;
}

const input = 'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm';

export default function LineItemsEditor({
  lines,
  onLinesChange,
  discount,
  onDiscountChange,
  taxRates,
  catalog,
  currency,
}: Props) {
  const defaultTax = taxRates.find((t) => t.is_default)?.id ?? '';
  const update = (i: number, patch: Partial<DraftLine>) =>
    onLinesChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => onLinesChange(lines.length > 1 ? lines.filter((_, j) => j !== i) : [emptyLine(defaultTax)]);

  const addFromCatalog = (id: string) => {
    const item = catalog.find((c) => c.id === id);
    if (!item) return;
    const line: DraftLine = {
      item_id: item.id,
      description: item.description ? `${item.name}\n${item.description}` : item.name,
      quantity: '1',
      unit_price: String(item.unit_price),
      tax_rate_id: item.tax_rate_id ?? defaultTax,
    };
    // Replace a single untouched blank row rather than appending under it.
    const blank = lines.length === 1 && !lines[0].description && !lines[0].unit_price;
    onLinesChange(blank ? [line] : [...lines, line]);
  };

  const { totals, error } = previewTotals(lines, taxRates, discount);
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);

  return (
    <div className="space-y-3" data-testid="line-items-editor">
      {lines.map((line, i) => (
        <div key={i} className="bg-gray-700/40 rounded-lg p-3 space-y-2">
          <div className="flex gap-2">
            <textarea
              aria-label={`Line ${i + 1} description`}
              value={line.description}
              onChange={(e) => update(i, { description: e.target.value, item_id: null })}
              rows={line.description.includes('\n') ? 2 : 1}
              placeholder="Description"
              className={input}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove line ${i + 1}`}
              className="px-2 text-gray-400 hover:text-red-400"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs text-gray-400">
              Qty
              <input
                type="number"
                step="any"
                min="0"
                value={line.quantity}
                onChange={(e) => update(i, { quantity: e.target.value })}
                className={input}
              />
            </label>
            <label className="text-xs text-gray-400">
              Rate
              <input
                type="number"
                step="0.01"
                min="0"
                value={line.unit_price}
                onChange={(e) => update(i, { unit_price: e.target.value })}
                placeholder="0.00"
                className={input}
              />
            </label>
            <label className="text-xs text-gray-400">
              Tax
              <select
                value={line.tax_rate_id}
                onChange={(e) => update(i, { tax_rate_id: e.target.value })}
                className={input}
              >
                <option value="">No tax</option>
                {taxRates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({Number(t.rate)}%)
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onLinesChange([...lines, emptyLine(defaultTax)])}
          className="text-sm text-purple-400 hover:text-purple-300"
        >
          + Add line
        </button>
        {catalog.length > 0 && (
          <select
            value=""
            onChange={(e) => addFromCatalog(e.target.value)}
            aria-label="Add a saved item"
            className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
          >
            <option value="">+ Add saved item…</option>
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({fmt(Number(c.unit_price))}
                {c.unit ? ` / ${c.unit}` : ''})
              </option>
            ))}
          </select>
        )}
        <Link href="/invoices/catalog" className="text-xs text-gray-500 hover:text-gray-300 ml-auto">
          Manage items &amp; tax rates
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-400">
          Discount
          <div className="flex gap-2">
            <input
              type="number"
              step="0.01"
              min="0"
              value={discount.value}
              onChange={(e) => onDiscountChange({ ...discount, value: e.target.value })}
              placeholder="0"
              className={input}
            />
            <select
              value={discount.type}
              onChange={(e) => onDiscountChange({ ...discount, type: e.target.value as DraftDiscount['type'] })}
              className="px-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
            >
              <option value="percent">%</option>
              <option value="fixed">{currency}</option>
            </select>
          </div>
        </label>
      </div>

      <div className="border-t border-gray-700 pt-3 text-sm space-y-1" data-testid="line-items-totals">
        {totals ? (
          <>
            <div className="flex justify-between text-gray-400">
              <span>Subtotal</span>
              <span>{fmt(totals.subtotal)}</span>
            </div>
            {totals.discount_total > 0 && (
              <div className="flex justify-between text-green-400">
                <span>Discount</span>
                <span>-{fmt(totals.discount_total)}</span>
              </div>
            )}
            {taxSummary(totals.line_items).map((t) => (
              <div key={`${t.name}-${t.rate}`} className="flex justify-between text-gray-400">
                <span>
                  {t.name} ({t.rate}%)
                </span>
                <span>{fmt(t.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between text-white font-semibold text-base">
              <span>Total</span>
              <span>{fmt(totals.total)}</span>
            </div>
          </>
        ) : (
          <p className="text-xs text-gray-500">{lines.some((l) => l.description || l.unit_price) ? error : 'Add a line to see the total.'}</p>
        )}
      </div>
    </div>
  );
}
