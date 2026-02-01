'use client';

interface BalanceCardProps {
  totalUsd: number;
  isLoading?: boolean;
}

export function BalanceCard({ totalUsd, isLoading }: BalanceCardProps) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-purple-600/20 to-pink-600/20 border border-purple-500/20 p-6">
      <p className="text-sm text-gray-400 mb-1">Total Balance</p>
      {isLoading ? (
        <div className="h-10 w-48 bg-white/10 rounded-lg animate-pulse" />
      ) : (
        <p className="text-4xl font-bold text-white">
          ${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      )}
      <p className="text-xs text-gray-500 mt-2">USD</p>
    </div>
  );
}
