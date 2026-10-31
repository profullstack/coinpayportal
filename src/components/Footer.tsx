import { Footer as ProfullstackFooter } from '@profullstack/footer/react';

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
  );
}
