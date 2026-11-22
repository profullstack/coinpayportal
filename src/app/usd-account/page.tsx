import { usdAccountsEnabled } from '@/lib/usd-accounts/providers';
import UsdAccountContent from './UsdAccountContent';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Get a US account · CoinPay',
  robots: { index: false, follow: false },
};

/**
 * /usd-account — Global USD accounts. Shipped dark: not linked from any nav,
 * and while USD_ACCOUNTS_ENABLED is unset it shows what the product is and
 * "coming soon" without calling any API.
 */
export default function UsdAccountPage() {
  return <UsdAccountContent enabled={usdAccountsEnabled()} />;
}
