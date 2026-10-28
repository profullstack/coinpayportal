import Link from 'next/link';
import { Footer as ProfullstackFooter } from '@profullstack/footer/react';

const links = [
  { name: 'Docs', href: '/docs' },
  { name: 'API', href: '/docs#api' },
  { name: 'Pricing', href: '/#pricing' },
  { name: 'About', href: '/about' },
  { name: 'Contact', href: '/contact' },
  { name: 'Help', href: '/help' },
  { name: 'Status', href: '/status' },
  { name: 'Who holds your money', href: '/custody' },
  { name: 'Privacy', href: '/privacy' },
  { name: 'Terms', href: '/terms' },
  { name: 'GitHub', href: 'https://github.com/profullstack/coinpayportal' },
  { name: 'Discord', href: 'https://discord.gg/U7dEXfBA3s' },
];

const linkClass = 'hover:text-purple-400 transition-colors';

export default function Footer() {
  const onionUrl = process.env.NEXT_PUBLIC_ONION_URL;

  return (
    <>
      <footer className="bg-slate-900 border-t border-slate-800 text-sm text-gray-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-3">
          <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2" aria-label="Footer">
            {links.map((link) =>
              link.href.startsWith('http') ? (
                <a key={link.name} href={link.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
                  {link.name}
                </a>
              ) : (
                <Link key={link.name} href={link.href} className={linkClass}>
                  {link.name}
                </Link>
              )
            )}
          </nav>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs">
            <a href="mailto:support@coinpayportal.com" className={linkClass}>
              support@coinpayportal.com
            </a>
            <a href="tel:+18885264640" className={linkClass}>
              +1-888-526-4640
            </a>
            {onionUrl && (
              <a href={onionUrl} target="_blank" rel="noopener noreferrer" title={onionUrl} className={linkClass}>
                Tor mirror
              </a>
            )}
            {/* The built.indie badge comes from @profullstack/footer below; one per page. */}
          </div>
        </div>
      </footer>
      {/* Copyright and the Profullstack webring: @profullstack/footer, server-rendered. */}
      <div className="bg-slate-900 text-gray-400">
        <ProfullstackFooter site="https://coinpayportal.com/" />
      </div>
    </>
  );
}
