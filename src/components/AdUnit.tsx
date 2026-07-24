'use client';

import { useEffect } from 'react';

// Our slot on the CrawlProof ad network. Overridable so a preview deploy can
// point at a test slot instead of billing the real one for impressions nobody
// sees.
const SLOT_ID =
  process.env.NEXT_PUBLIC_AD_SLOT_ID ?? '4afedddc-82dc-490b-a9e6-91ae8fcc0fd0';

const SCRIPT_SRC = 'https://crawlproof.com/ad.js';

type AdFormat = 'banner_300x250' | 'banner_728x90' | 'banner_320x50' | 'text_link';

declare global {
  interface Window {
    crawlproofAds?: { scan: () => void };
  }
}

/**
 * A single ad container filled by crawlproof.com/ad.js.
 *
 * Omitting `format` lets the script size the unit to its container — a
 * leaderboard on desktop, a mobile banner on narrow screens. The script only
 * auto-scans once at load, so units mounted by client-side navigation have to
 * re-trigger the scan it exposes.
 */
export default function AdUnit({
  format,
  className,
}: {
  format?: AdFormat;
  className?: string;
}) {
  useEffect(() => {
    if (window.crawlproofAds) {
      window.crawlproofAds.scan();
      return;
    }
    // First unit on the page loads the script; later ones ride the same tag.
    if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return;
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    document.body.appendChild(s);
  }, []);

  return <div data-cp-ad data-slot={SLOT_ID} data-format={format} className={className} />;
}
