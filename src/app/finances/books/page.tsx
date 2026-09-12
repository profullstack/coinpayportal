import type { Metadata } from 'next';
import BooksContent from './BooksContent';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Books · CoinPay',
  robots: { index: false, follow: false },
};

/** /finances/books — review auto-categorised transactions and export the CPA pack. */
export default function FinanceBooksPage() {
  return <BooksContent />;
}
