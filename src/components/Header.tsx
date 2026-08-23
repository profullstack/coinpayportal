'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const GITHUB_REPO_URL = 'https://github.com/profullstack/coinpayportal';

export default function Header() {
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // Mark as hydrated and check if user is logged in
    const token = localStorage.getItem('auth_token');
    setIsLoggedIn(!!token);
    setIsHydrated(true);
    if (token) {
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => setIsAdmin(!!data?.merchant?.is_admin))
        .catch(() => {});
    }
  }, []);

  // Listen for storage changes (e.g., login/logout in another tab)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'auth_token') {
        setIsLoggedIn(!!e.newValue);
      }
    };

    // Also listen for custom auth events within the same tab
    const handleAuthChange = () => {
      const token = localStorage.getItem('auth_token');
      setIsLoggedIn(!!token);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('auth-change', handleAuthChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('auth-change', handleAuthChange);
    };
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // best-effort — still clear local state below
    }
    localStorage.removeItem('auth_token');
    setIsLoggedIn(false);
    setIsAdmin(false);
    setUserMenuOpen(false);
    router.push('/');
    router.refresh();
  };

  const PUBLIC_ROUTES = new Set(['/', '/web-wallet', '/docs', '/blog', '/pricing', '/did']);

  const navigation = [
    { name: 'Home', href: '/' },
    { name: 'Wallet', href: '/web-wallet' },
    { name: 'API', href: '/docs' },
    { name: 'Blog', href: '/blog' },
    { name: 'DID', href: '/did' },
    { name: 'Reputation', href: '/reputation' },
    { name: 'Pricing', href: '/pricing' },
    { name: 'x402', href: '/x402' },
  ];

  const loggedInNavigation = [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Proposals', href: '/proposals' },
    { name: 'Invoices', href: '/invoices' },
    { name: 'Escrow', href: '/escrow' },
    { name: 'Wallet', href: '/web-wallet' },
    { name: 'API', href: '/docs' },
    { name: 'Blog', href: '/blog' },
    { name: 'Developer', href: '/dashboard/oauth' },
    { name: 'DID', href: '/did' },
    { name: 'Reputation', href: '/reputation' },
    { name: 'x402', href: '/x402' },
  ];

  const currentNav = isLoggedIn ? loggedInNavigation : navigation;

  const getNavHref = (href: string) => {
    if (isLoggedIn || PUBLIC_ROUTES.has(href)) return href;
    return `/login?redirect=${encodeURIComponent(href)}`;
  };

  return (
    <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50" style={{ WebkitTransform: 'translateZ(0)' }}>
      <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" aria-label="Top">
        <div className="flex w-full items-center justify-between py-3">
          {/* Logo */}
          <Link href="/" className="block">
            <img
              src="/logo.svg"
              alt="CoinPay"
              className="h-14 w-auto"
            />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex md:items-center md:space-x-8">
            {currentNav.map((item) => (
              <Link
                key={item.name}
                href={getNavHref(item.href)}
                className="text-sm font-medium text-gray-300 hover:text-white transition-colors"
              >
                {item.name}
              </Link>
            ))}
            
            {/* Source link, on every page rather than just the homepage — the
                docs are where developers spend their time, and that is exactly
                where "can I read the code?" needs answering without a hunt. */}
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              title="CoinPay on GitHub — open source, MIT"
              aria-label="CoinPay on GitHub — open source, MIT licensed"
              className="text-gray-300 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
            </a>

            {/* Auth Buttons / User Menu */}
            {isHydrated && isLoggedIn ? (
              <div className="flex items-center space-x-4">
                <div className="relative">
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    className="flex items-center space-x-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
                  >
                    <div className="h-8 w-8 rounded-full bg-purple-600 flex items-center justify-center">
                      <span className="text-white text-sm font-semibold">M</span>
                    </div>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {userMenuOpen && (
                    <div className="absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5">
                      <div className="py-1">
                        <Link
                          href="/dashboard"
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          Dashboard
                        </Link>
                        <Link
                          href="/settings/wallets"
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          Global Wallets
                        </Link>
                        <Link
                          href="/settings/security"
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          Security
                        </Link>
                        <Link
                          href="/settings"
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          Settings
                        </Link>
                        <Link
                          href="/finances"
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          Finances
                        </Link>
                        {isAdmin && (
                          <Link
                            href="/admin"
                            className="block px-4 py-2 text-sm font-semibold text-purple-700 hover:bg-gray-100"
                            onClick={() => setUserMenuOpen(false)}
                          >
                            Admin
                          </Link>
                        )}
                        <button
                          onClick={handleLogout}
                          className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Log out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center space-x-4">
                <Link
                  href="/login"
                  className="text-sm font-medium text-gray-300 hover:text-white transition-colors"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-purple-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600 transition-colors"
                >
                  Sign up
                </Link>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="flex md:hidden">
            <button
              type="button"
              className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-gray-300 hover:text-white"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <span className="sr-only">
                {mobileMenuOpen ? 'Close menu' : 'Open menu'}
              </span>
              {mobileMenuOpen ? (
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              ) : (
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-800 py-4 max-h-[calc(100dvh_-_5rem)] overflow-y-auto overscroll-contain">
            <div className="space-y-1">
              {currentNav.map((item) => (
                <Link
                  key={item.name}
                  href={getNavHref(item.href)}
                  className="block px-3 py-2 text-base font-medium text-gray-300 hover:bg-gray-800 hover:text-white rounded-md transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.name}
                </Link>
              ))}
              
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-base font-medium text-gray-300 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                </svg>
                Source on GitHub
              </a>

              {/* Mobile Auth Buttons / User Menu */}
              {isHydrated && isLoggedIn ? (
                <div className="pt-4 space-y-2 border-t border-gray-800 mt-4">
                  <Link
                    href="/dashboard"
                    className="block px-3 py-2 text-base font-medium text-gray-300 hover:bg-gray-800 hover:text-white rounded-md transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Dashboard
                  </Link>
                  <Link
                    href="/settings/wallets"
                    className="block px-3 py-2 text-base font-medium text-gray-300 hover:bg-gray-800 hover:text-white rounded-md transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Global Wallets
                  </Link>
                  <Link
                    href="/settings/security"
                    className="block px-3 py-2 text-base font-medium text-gray-300 hover:bg-gray-800 hover:text-white rounded-md transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Security
                  </Link>
                  <Link
                    href="/settings"
                    className="block px-3 py-2 text-base font-medium text-gray-300 hover:bg-gray-800 hover:text-white rounded-md transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Settings
                  </Link>
                  <Link
                    href="/finances"
                    className="block px-3 py-2 text-base font-medium text-gray-300 hover:bg-gray-800 hover:text-white rounded-md transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Finances
                  </Link>
                  {isAdmin && (
                    <Link
                      href="/admin"
                      className="block px-3 py-2 text-base font-semibold text-purple-300 hover:bg-gray-800 hover:text-white rounded-md transition-colors"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Admin
                    </Link>
                  )}
                  <button
                    onClick={() => {
                      handleLogout();
                      setMobileMenuOpen(false);
                    }}
                    className="block w-full text-left px-3 py-2 text-base font-medium text-gray-300 hover:bg-gray-800 hover:text-white rounded-md transition-colors"
                  >
                    Log out
                  </button>
                </div>
              ) : (
                <div className="pt-4 space-y-2">
                  <Link
                    href="/login"
                    className="block px-3 py-2 text-base font-medium text-gray-300 hover:bg-gray-800 hover:text-white rounded-md transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Log in
                  </Link>
                  <Link
                    href="/signup"
                    className="block px-3 py-2 text-base font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-md transition-colors text-center"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Sign up
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}