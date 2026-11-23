import '@profullstack/checkout/checkout.css';
import { Checkout } from '@profullstack/checkout/react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { upgradeAccountForPage, upgradeCheckout, upgradeSignInUrl } from '@/lib/subscriptions/upgrade';

export const metadata: Metadata = {
  title: 'Upgrade to Professional - CoinPay',
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

/**
 * /upgrade: pick monthly or yearly for the Professional plan, then pay on the
 * hosted checkout. Prefilled from the link (?plan=yearly|monthly&source=...).
 * The form posts to /api/subscriptions/upgrade and works without JavaScript.
 *
 * Not under /checkout: /checkout/<id> is the hosted payer page.
 */
export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const merchant = await upgradeAccountForPage((await headers()).get('cookie'));
  if (!merchant) redirect(upgradeSignInUrl(query));

  const view = upgradeCheckout().view({ query, account: { id: merchant.id, email: merchant.email } });

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <Checkout view={view} />
        <p className="mt-6 text-center text-sm text-gray-400">
          <Link href="/pricing" className="text-purple-400 font-semibold hover:text-purple-300">
            Compare plans
          </Link>
        </p>
      </div>
    </div>
  );
}
