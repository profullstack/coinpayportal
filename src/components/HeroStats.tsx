'use client';

import { useEffect, useState } from 'react';
import { SETTLEMENT_ASSET_COUNT } from '@/lib/wallets/supported-chains';
import { formatCount, formatUsd, type PublicStats } from '@/lib/stats/public-stats';

/**
 * The hero counters.
 *
 * Fetched from `/api/public-stats` at request time rather than rendered on the
 * server. The landing page is prerendered during `pnpm build`, where
 * `SUPABASE_SERVICE_ROLE_KEY` is intentionally absent — the Dockerfile forwards
 * only `NEXT_PUBLIC_*` build args — so a server render could only ever fail
 * closed. That is exactly what shipped: a homepage with no stats on it. The
 * route handler runs where the key exists, and fetching from the client keeps
 * the page itself static.
 *
 * The numbers these replaced were literals overstated between 9x and 720x, so
 * the rule worth holding is unchanged: nothing renders unless it was measured.
 * No skeleton, no placeholder, no last-known value — while loading, and on any
 * failure, this is empty.
 */

/** Pure renderer, split out so the fail-closed rule stays directly testable. */
export function HeroStatsView({ stats }: { stats: PublicStats | null }) {
  if (!stats) return null;

  const tiles = [
    { label: 'Payments Settled', value: formatCount(stats.paymentsSettled) },
    { label: 'Active Businesses', value: formatCount(stats.activeBusinesses) },
    { label: 'Settled Volume', value: formatUsd(stats.settledVolumeUsd) },
    { label: 'Settlement Assets', value: `${SETTLEMENT_ASSET_COUNT}` },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto mb-12">
      {tiles.map((stat) => (
        <div
          key={stat.label}
          className="text-center p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10"
        >
          <div className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-2">
            {stat.value}
          </div>
          <div className="text-sm text-gray-400">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}

export function HeroStats() {
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/public-stats', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body?.success && body.stats) setStats(body.stats as PublicStats);
      })
      .catch(() => {
        // Includes the abort on unmount. Nothing to show either way.
      });

    return () => controller.abort();
  }, []);

  return <HeroStatsView stats={stats} />;
}
