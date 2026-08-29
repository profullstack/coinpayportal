import { NextRequest, NextResponse } from 'next/server';
import { guardBankDataRequest } from '@/lib/bankdata/guard';
import { BankDataError, type BankTransaction } from '@/lib/bankdata';
import { listTransactions } from '@/lib/bankdata/service';

/**
 * Render transactions as CSV for a bookkeeper or an accounting-package import.
 *
 * Amounts are written back in major units with two decimals, because that is what
 * every accounting tool expects on import — minor units are an internal storage
 * decision, not an interchange format.
 */
function toCsv(transactions: BankTransaction[]): string {
  const header = ['date', 'description', 'counterparty', 'amount', 'currency', 'category', 'pending'];

  const escape = (value: string | null): string => {
    const text = value ?? '';
    // Quote anything containing a delimiter, quote or newline; double inner quotes.
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const rows = transactions.map((t) =>
    [
      t.date,
      escape(t.description),
      escape(t.counterparty),
      (t.amountMinor / 100).toFixed(2),
      t.currency,
      escape(t.category),
      String(t.pending),
    ].join(','),
  );

  return [header.join(','), ...rows].join('\n');
}

/**
 * GET /api/bankdata/transactions?business_id=…&from=…&to=…&format=csv
 *
 * List imported bank and card activity. `format=csv` returns a download suitable for
 * QuickBooks/Xero import, which is the fastest path to value for a merchant who just
 * wants their books to balance.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    const guard = await guardBankDataRequest(
      request.headers.get('authorization'),
      businessId,
      'business.read',
    );
    if (!guard.ok) {
      return NextResponse.json({ success: false, error: guard.error }, { status: guard.status });
    }

    const transactions = await listTransactions(guard.supabase, businessId as string, {
      connectionId: searchParams.get('connection_id') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      limit: Number(searchParams.get('limit')) || undefined,
    });

    if (searchParams.get('format') === 'csv') {
      return new NextResponse(toCsv(transactions), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="bank-transactions.csv"',
        },
      });
    }

    return NextResponse.json({ success: true, transactions });
  } catch (error) {
    if (error instanceof BankDataError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 502 });
    }
    console.error('Error listing bank transactions:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
