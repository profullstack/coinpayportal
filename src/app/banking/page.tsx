import BankingContent from './BankingContent';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Bank transfers · CoinPay',
  robots: { index: false, follow: false },
};

/**
 * /banking — a merchant's linked US bank accounts and ACH transfers.
 *
 * Same shape as /finances: the client component checks the session on mount,
 * and every route behind it re-checks and scopes by merchant. The page guard
 * is convenience, the route guards are the boundary.
 */
export default function BankingPage() {
  return <BankingContent />;
}
