import { taxSummary } from '@/lib/invoices/line-items';

export interface InvoiceLine {
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number | null;
  tax_name: string | null;
  amount: number;
  discount: number;
  tax: number;
}

interface Props {
  lines: InvoiceLine[];
  currency: string;
  subtotal: number | string | null;
  discountTotal: number | string | null;
  taxTotal: number | string | null;
  total: number | string;
}

/** Itemised breakdown shown to merchant and payer alike. */
export default function LineItemsTable({ lines, currency, subtotal, discountTotal, taxTotal, total }: Props) {
  const fmt = (n: number | string | null) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n ?? 0));
  const discount = Number(discountTotal ?? 0);
  const taxes = taxSummary(lines);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-400 border-b border-gray-700">
            <th className="text-left font-medium py-2 pr-2">Item</th>
            <th className="text-right font-medium py-2 px-2">Qty</th>
            <th className="text-right font-medium py-2 px-2">Rate</th>
            <th className="text-right font-medium py-2 pl-2">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="border-b border-gray-800 align-top">
              <td className="py-2 pr-2 text-white whitespace-pre-wrap break-words">
                {line.description}
                {line.tax_rate ? (
                  <span className="block text-xs text-gray-500">
                    {line.tax_name || 'Tax'} {line.tax_rate}%
                  </span>
                ) : null}
              </td>
              <td className="py-2 px-2 text-right text-gray-300">{line.quantity}</td>
              <td className="py-2 px-2 text-right text-gray-300">{fmt(line.unit_price)}</td>
              <td className="py-2 pl-2 text-right text-white">{fmt(line.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="pt-3 text-right text-gray-400">Subtotal</td>
            <td className="pt-3 text-right text-gray-200">{fmt(subtotal)}</td>
          </tr>
          {discount > 0 && (
            <tr>
              <td colSpan={3} className="text-right text-gray-400">Discount</td>
              <td className="text-right text-green-400">-{fmt(discount)}</td>
            </tr>
          )}
          {taxes.map((t) => (
            <tr key={`${t.name}-${t.rate}`}>
              <td colSpan={3} className="text-right text-gray-400">
                {t.name} ({t.rate}%)
              </td>
              <td className="text-right text-gray-200">{fmt(t.amount)}</td>
            </tr>
          ))}
          {taxes.length === 0 && Number(taxTotal ?? 0) > 0 && (
            <tr>
              <td colSpan={3} className="text-right text-gray-400">Tax</td>
              <td className="text-right text-gray-200">{fmt(taxTotal)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={3} className="pt-2 text-right font-semibold text-white">Total</td>
            <td className="pt-2 text-right font-semibold text-white">{fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
