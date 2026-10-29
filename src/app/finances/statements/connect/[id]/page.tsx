import type { Metadata } from 'next';
import Link from 'next/link';
import { CLOUD_BANK_BROWSER_OFF_MESSAGE } from '@/lib/finances/cloud-disabled';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Connect your bank · CoinPay',
  robots: { index: false, follow: false },
};

/** /finances/statements/connect/:id — the cloud bank browser is off; say so. */
export default function ConnectBankPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-xl font-semibold">Cloud bank sign-in is off</h1>
      <p className="mt-3 text-sm opacity-80">{CLOUD_BANK_BROWSER_OFF_MESSAGE}</p>
      <p className="mt-6">
        <Link href="/finances" className="underline">
          Back to Finances
        </Link>
      </p>
    </main>
  );
}
