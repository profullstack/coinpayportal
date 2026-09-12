import type { Metadata } from 'next';
import FinancesContent from '../FinancesContent';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Finance reports · CoinPay',
  robots: { index: false, follow: false },
};

/**
 * /finances/reports — the finances console, scrolled to Reports.
 *
 * One page on purpose: reports are built from the same accounts and ledger
 * the rest of the console shows, and a separate route would be a separately
 * stale view of the same money.
 */
export default function FinanceReportsPage() {
  return <FinancesContent focus="reports" />;
}
