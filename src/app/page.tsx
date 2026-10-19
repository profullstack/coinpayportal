import type { Metadata } from 'next';
import { HomeContent } from '@/components/home/HomeContent';

// ad.network verifies the site by fetching this page's raw HTML for the code.
export const metadata: Metadata = {
  other: { 'ad.network': 'pUTEpva09JC1uuOu' },
};

// Stays statically prerendered. The hero counters cannot be read at build time
// — the service-role key is deliberately not a Docker build arg — so HeroStats
// fetches them from /api/public-stats at request time instead of forcing this
// whole page to render per request for the sake of three integers.
export default function Home() {
  return <HomeContent />;
}
