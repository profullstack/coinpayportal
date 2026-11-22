import { Footer as ProfullstackFooter } from '@profullstack/footer/react';

const PRODUCTWATCH_EMBED =
  '<a href="https://productwatch.io/products/coinpay?utm_source=badge" target="_blank"><img src="https://productwatch.io/backend/api/v1/badge/featured?productId=80962a69-8555-4397-85a8-bfda39a2e48e&darkMode=false" alt="CoinPay" style="max-width: 250px;" /></a>';

const links = [
  { label: 'Docs', href: '/docs' },
  { label: 'API', href: '/docs#api' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
  { label: 'Help', href: '/help' },
  { label: 'Status', href: '/status' },
  { label: 'Who holds your money', href: '/custody' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'GitHub', href: 'https://github.com/profullstack/coinpayportal' },
  { label: 'Discord', href: 'https://discord.gg/U7dEXfBA3s' },
];

export default function Footer() {
  const onionUrl = process.env.NEXT_PUBLIC_ONION_URL;

  return (
    <>
      {/* "Featured on ProductWatch": ProductWatch's verifier string-matches its embed code,
          so it is injected byte-for-byte as raw HTML. Do NOT convert to JSX or edit it:
          JSX re-serializes it (&amp;, max-width:250px) and verification fails. */}
      <div
        style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem 1rem 0' }}
        dangerouslySetInnerHTML={{ __html: PRODUCTWATCH_EMBED }}
      />
      <ProfullstackFooter
        site="https://coinpayportal.com/"
        owner={{ name: 'CoinPay', url: 'https://coinpayportal.com/' }}
        links={[
          ...links,
          { label: 'support@coinpayportal.com', href: 'mailto:support@coinpayportal.com' },
          { label: '+1-888-526-4640', href: 'tel:+18885264640' },
          ...(onionUrl ? [{ label: 'Tor mirror', href: onionUrl }] : []),
        ]}
        builtIndieHref="https://built.indie.pit.world/p/coinpay?ref=badge"
      />
    </>
  );
}
