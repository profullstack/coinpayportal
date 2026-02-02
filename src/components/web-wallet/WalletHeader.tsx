'use client';

import Link from 'next/link';
import { useWebWallet } from './WalletContext';

export function WalletHeader() {
  const { isUnlocked, walletId, lock } = useWebWallet();

  return (
    <div className="border-b border-white/10 bg-slate-900/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link
          href="/web-wallet"
          className="text-lg font-bold text-white hover:text-purple-400 transition-colors"
        >
          CoinPay Wallet
        </Link>

        {isUnlocked && (
          <div className="flex items-center gap-4">
            <nav className="hidden sm:flex items-center gap-1">
              <NavLink href="/web-wallet">Dashboard</NavLink>
              <NavLink href="/web-wallet/send">Send</NavLink>
              <NavLink href="/web-wallet/receive">Receive</NavLink>
              <NavLink href="/web-wallet/history">History</NavLink>
              <NavLink href="/web-wallet/settings">Settings</NavLink>
            </nav>

            <div className="flex items-center gap-3">
              <span className="hidden md:block text-xs text-gray-400 font-mono">
                {walletId?.slice(0, 8)}...
              </span>
              <button
                onClick={lock}
                className="rounded-lg bg-white/5 px-3 py-1.5 text-sm text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
              >
                Lock
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mobile nav */}
      {isUnlocked && (
        <div className="flex sm:hidden border-t border-white/5 overflow-x-auto">
          <NavLink href="/web-wallet" mobile>Dashboard</NavLink>
          <NavLink href="/web-wallet/send" mobile>Send</NavLink>
          <NavLink href="/web-wallet/receive" mobile>Receive</NavLink>
          <NavLink href="/web-wallet/history" mobile>History</NavLink>
          <NavLink href="/web-wallet/settings" mobile>Settings</NavLink>
        </div>
      )}
    </div>
  );
}

function NavLink({
  href,
  children,
  mobile,
}: {
  href: string;
  children: React.ReactNode;
  mobile?: boolean;
}) {
  const base = mobile
    ? 'flex-1 text-center px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors whitespace-nowrap'
    : 'rounded-lg px-3 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors';

  return (
    <Link href={href} className={base}>
      {children}
    </Link>
  );
}
