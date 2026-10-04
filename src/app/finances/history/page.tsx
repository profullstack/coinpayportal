import type { Metadata } from 'next';
import HistoryContent from './HistoryContent';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Report history · CoinPay',
  robots: { index: false, follow: false },
};

/** /finances/history — generated, emailed and uploaded business reports in one timeline. */
export default function FinanceHistoryPage() {
  return <HistoryContent />;
}
