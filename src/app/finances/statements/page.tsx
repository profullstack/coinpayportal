import type { Metadata } from 'next';
import FinancesContent from '../FinancesContent';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Bank statements · CoinPay',
  robots: { index: false, follow: false },
};

/** /finances/statements — the finances console, scrolled to Statements. */
export default function FinanceStatementsPage() {
  return <FinancesContent focus="statements" />;
}
