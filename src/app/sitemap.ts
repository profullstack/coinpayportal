import { MetadataRoute } from 'next';

const BASE_URL = 'https://coinpayportal.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    '/',
    '/login',
    '/signup',
    '/pricing',
    '/wallet',
    '/dashboard',
    '/terms',
    '/privacy',
    '/docs',
    '/about',
    '/contact',
    '/escrow',
    '/reputation',
    '/status',
    '/help',
  ];

  return routes.map((route) => ({
    url: `${BASE_URL}${route}`,
    changeFrequency: 'weekly' as const,
    priority: route === '/' ? 1 : 0.8,
  }));
}
