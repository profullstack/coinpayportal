import { SETTLEMENT_ASSET_COUNT } from '@/lib/wallets/supported-chains';
import { formatCount, formatUsd, type PublicStats } from '@/lib/stats/public-stats';

/**
 * The hero counters.
 *
 * Split out of `page.tsx` so the fail-closed rule is testable rather than
 * merely intended: when the database cannot be read, this renders nothing at
 * all. The numbers it used to hold were literals — 47K+ transactions, $8.2M+
 * volume — that had drifted between 9x and 720x from reality, so the one
 * behaviour worth pinning is that no number appears unless it was measured.
 */
export function HeroStats({ stats }: { stats: PublicStats | null }) {
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
