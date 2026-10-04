'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Hero-level promotion only on the homepage; never on wallet/dashboard routes. */
export function HomeGuidePromotion() {
  const pathname = usePathname();
  if (pathname !== '/') return null;
  return (
    <aside aria-label="Free founder's field guide" className="border-b border-[#bd855e]/40 bg-[#f4f1e9] text-[#203b2f]">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-7 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#9b4d2b]">From the creators of CoinPayPortal / Free PDF</p>
          <h2 className="font-serif text-2xl font-semibold">Run your online S-corp with a clearer plan.</h2>
          <p className="mt-1 max-w-2xl text-sm">Los Gatos &amp; surrounding cities. Accounting tips for humans. Technical guidance for agents.</p>
        </div>
        <Link href="/get-guide?source=homepage" className="inline-flex shrink-0 items-center justify-center rounded-lg bg-[#203b2f] px-6 py-3 font-semibold text-white transition hover:bg-[#2d5040] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#203b2f]">Get the free PDF <span aria-hidden="true" className="ml-2">&rarr;</span></Link>
      </div>
    </aside>
  );
}
