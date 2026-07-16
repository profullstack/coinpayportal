'use client';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

export interface ChartSeriesPoint {
  label: string;
  crypto_volume_usd: number;
  card_volume_usd: number;
  total_volume_usd: number;
  crypto_count: number;
  card_count: number;
  total_count: number;
}

export interface DashboardChartsProps {
  series: { granularity: string; points: ChartSeriesPoint[] } | undefined;
  methodSplit: { cryptoVolume: number; cardVolume: number };
  statusBreakdown: { succeeded: number; failed: number; pending: number };
}

const CRYPTO = '#3b82f6'; // blue-500
const CARD = '#22c55e'; // green-500
const AXIS = '#9ca3af'; // gray-400 — legible in light & dark
const GRID = '#9ca3af33';
const STATUS_COLORS = { succeeded: '#22c55e', failed: '#ef4444', pending: '#eab308' };

const usd0 = (n: number) => `$${Math.round(n).toLocaleString()}`;
const usd2 = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Drop the year from daily/weekly labels (YYYY-MM-DD -> MM-DD) to keep the axis tidy.
const shortLabel = (label: string) => (label?.length === 10 ? label.slice(5) : label);

const tooltipStyle = {
  backgroundColor: '#1f2937',
  border: 'none',
  borderRadius: 8,
  color: '#f9fafb',
  fontSize: 12,
};

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
      <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function EmptyChart({ height = 240 }: { height?: number }) {
  return (
    <div
      className="flex items-center justify-center text-sm text-gray-400 dark:text-gray-500"
      style={{ height }}
    >
      No data for the selected filters
    </div>
  );
}

export default function DashboardCharts({ series, methodSplit, statusBreakdown }: DashboardChartsProps) {
  const points = series?.points ?? [];
  const hasSeries = points.some((p) => p.total_count > 0 || p.total_volume_usd > 0);

  const splitData = [
    { name: 'Crypto', value: methodSplit.cryptoVolume, color: CRYPTO },
    { name: 'Card', value: methodSplit.cardVolume, color: CARD },
  ].filter((d) => d.value > 0);

  const statusData = [
    { name: 'Succeeded', value: statusBreakdown.succeeded, color: STATUS_COLORS.succeeded },
    { name: 'Failed', value: statusBreakdown.failed, color: STATUS_COLORS.failed },
    { name: 'Pending', value: statusBreakdown.pending, color: STATUS_COLORS.pending },
  ];
  const hasStatus = statusData.some((d) => d.value > 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      <ChartCard title="Volume over time (USD)">
        {hasSeries ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={points} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tickFormatter={shortLabel} tick={{ fill: AXIS, fontSize: 11 }} minTickGap={16} />
              <YAxis tickFormatter={usd0} tick={{ fill: AXIS, fontSize: 11 }} width={56} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: any, name: any) => [usd2(Number(v)), name === 'crypto_volume_usd' ? 'Crypto' : 'Card']}
              />
              <Legend formatter={(v) => (v === 'crypto_volume_usd' ? 'Crypto' : 'Card')} />
              <Area type="monotone" dataKey="crypto_volume_usd" stackId="v" stroke={CRYPTO} fill={CRYPTO} fillOpacity={0.35} />
              <Area type="monotone" dataKey="card_volume_usd" stackId="v" stroke={CARD} fill={CARD} fillOpacity={0.35} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart />
        )}
      </ChartCard>

      <ChartCard title="Transactions over time">
        {hasSeries ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={points} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tickFormatter={shortLabel} tick={{ fill: AXIS, fontSize: 11 }} minTickGap={16} />
              <YAxis allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }} width={36} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: any, name: any) => [Number(v), name === 'crypto_count' ? 'Crypto' : 'Card']}
              />
              <Legend formatter={(v) => (v === 'crypto_count' ? 'Crypto' : 'Card')} />
              <Bar dataKey="crypto_count" stackId="c" fill={CRYPTO} />
              <Bar dataKey="card_count" stackId="c" fill={CARD} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart />
        )}
      </ChartCard>

      <ChartCard title="Payment method split (volume)">
        {splitData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={splitData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {splitData.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: any) => [usd2(Number(v)), name]} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart />
        )}
      </ChartCard>

      <ChartCard title="Status breakdown (transactions)">
        {hasStatus ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={statusData} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: AXIS, fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }} width={36} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#9ca3af22' }} formatter={(v: any) => [Number(v), 'Transactions']} />
              <Bar dataKey="value">
                {statusData.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart />
        )}
      </ChartCard>
    </div>
  );
}
