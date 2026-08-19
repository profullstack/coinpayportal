import { requireAdminPage } from '@/lib/auth/admin-guard';
import FinancesContent from './FinancesContent';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Finances · CoinPay',
  robots: { index: false, follow: false },
};

/**
 * /finances — the house balance sheet.
 *
 * Gated server-side rather than in the client component, so the page never
 * renders for a non-admin even for the moment before a fetch resolves. The API
 * routes behind it repeat the check; this one is about what reaches the browser.
 */
export default async function FinancesPage() {
  await requireAdminPage('/finances');
  return <FinancesContent />;
}
