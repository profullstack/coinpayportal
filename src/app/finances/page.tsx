import FinancesContent from './FinancesContent';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Finances · CoinPay',
  robots: { index: false, follow: false },
};

/**
 * /finances — a merchant's own bank accounts and credit cards.
 *
 * Any signed-in merchant may reach this; what they see is scoped to the
 * SimpleFIN connections they own. The client component calls `requireAuth` on
 * mount the way /dashboard does, and every API route behind it re-checks the
 * session and scopes by merchant id — the page guard is convenience, the route
 * guards are the boundary.
 */
export default function FinancesPage() {
  return <FinancesContent />;
}
