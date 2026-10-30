'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ADMIN_SECTIONS } from './admin-navigation';

export default function AdminNav() {
  const pathname = (usePathname() ?? '').replace(/\/$/, '');

  return (
    <div className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-950">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Administration
        </p>
        <nav aria-label="Administration" className="flex flex-wrap gap-2">
          {ADMIN_SECTIONS.map(({ href, label }) => {
            const active = pathname === href || (href !== '/admin' && pathname.startsWith(`${href}/`));
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 ${
                  active
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-purple-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
