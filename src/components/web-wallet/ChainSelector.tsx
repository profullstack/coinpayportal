'use client';

const ALL_CHAINS = [
  { id: 'BTC', name: 'Bitcoin', symbol: 'BTC' },
  { id: 'BCH', name: 'Bitcoin Cash', symbol: 'BCH' },
  { id: 'ETH', name: 'Ethereum', symbol: 'ETH' },
  { id: 'POL', name: 'Polygon', symbol: 'POL' },
  { id: 'SOL', name: 'Solana', symbol: 'SOL' },
  { id: 'DOGE', name: 'Dogecoin', symbol: 'DOGE' },
  { id: 'XRP', name: 'Ripple', symbol: 'XRP' },
  { id: 'ADA', name: 'Cardano', symbol: 'ADA' },
  { id: 'BNB', name: 'BNB Chain', symbol: 'BNB' },
  { id: 'USDT', name: 'Tether', symbol: 'USDT' },
  { id: 'USDC', name: 'USD Coin', symbol: 'USDC' },
  { id: 'USDC_ETH', name: 'USDC (Ethereum)', symbol: 'USDC' },
  { id: 'USDC_POL', name: 'USDC (Polygon)', symbol: 'USDC' },
  { id: 'USDC_SOL', name: 'USDC (Solana)', symbol: 'USDC' },
  { id: 'USDT_ETH', name: 'USDT (Ethereum)', symbol: 'USDT' },
  { id: 'USDT_POL', name: 'USDT (Polygon)', symbol: 'USDT' },
  { id: 'USDT_SOL', name: 'USDT (Solana)', symbol: 'USDT' },
] as const;

interface BalanceInfo {
  balance: string;
  usdValue?: number;
}

interface ChainSelectorProps {
  value: string;
  onChange: (chain: string) => void;
  chains?: string[];
  label?: string;
  disabled?: boolean;
  balances?: Record<string, BalanceInfo>;
}

export function ChainSelector({
  value,
  onChange,
  chains,
  label,
  disabled = false,
  balances,
}: ChainSelectorProps) {
  const available = chains
    ? ALL_CHAINS.filter((c) => chains.includes(c.id))
    : ALL_CHAINS;

  // Format balance for display
  const formatBalance = (chainId: string): string => {
    if (!balances || !balances[chainId]) return '';
    const bal = balances[chainId];
    const numBal = parseFloat(bal.balance);
    if (numBal === 0) return ' • 0';
    if (numBal < 0.0001) return ' • <0.0001';
    if (numBal < 1) return ` • ${numBal.toFixed(4)}`;
    if (numBal < 1000) return ` • ${numBal.toFixed(2)}`;
    return ` • ${numBal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-gray-300">
          {label}
        </label>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50 appearance-none"
      >
        <option value="" className="bg-slate-900">
          Select chain
        </option>
        {available.map((chain) => (
          <option key={chain.id} value={chain.id} className="bg-slate-900">
            {chain.name} ({chain.symbol}){formatBalance(chain.id)}
          </option>
        ))}
      </select>
    </div>
  );
}

interface ChainMultiSelectProps {
  value: string[];
  onChange: (chains: string[]) => void;
  label?: string;
}

export function ChainMultiSelect({
  value,
  onChange,
  label,
}: ChainMultiSelectProps) {
  const toggle = (chainId: string) => {
    if (value.includes(chainId)) {
      onChange(value.filter((c) => c !== chainId));
    } else {
      onChange([...value, chainId]);
    }
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-gray-300">
          {label}
        </label>
      )}
      <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-2">
        {ALL_CHAINS.map((chain) => {
          const selected = value.includes(chain.id);
          return (
            <button
              key={chain.id}
              type="button"
              onClick={() => toggle(chain.id)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                selected
                  ? 'border-purple-500 bg-purple-500/10 text-white'
                  : 'border-white/10 bg-white/5 text-gray-400 hover:border-white/20 hover:text-white'
              }`}
            >
              <span className="font-medium">{chain.symbol}</span>
              <span className="ml-1 text-xs text-gray-400">{chain.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
