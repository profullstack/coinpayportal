import { NextResponse } from 'next/server';
import { BUSINESS_CATEGORIES } from '@/lib/business/taxonomy';

/**
 * GET /api/businesses/categories — the taxonomy a business may be created with.
 *
 * Exists because `category` is required on create and there was no way to find out
 * what a valid one was without reading the source. `coinpay business create` failed
 * with "Select a valid business category" and offered nothing further; the obvious
 * workaround -- a copy of the list inside the CLI -- is how that same error happens
 * again the next time the taxonomy changes and nobody republishes.
 *
 * Public and unauthenticated on purpose. It is a fixed list of labels, it is what a
 * signup form needs before anybody has an account, and there is nothing in it that
 * is not already visible on the marketing site.
 *
 * `keywords` is deliberately withheld. Those drive the risk classifier, and
 * publishing the exact strings it matches on is publishing how to dress a business
 * up as a safer one.
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    categories: BUSINESS_CATEGORIES.map(({ slug, label, group, baseRisk }) => ({
      slug,
      label,
      group,
      baseRisk,
    })),
  });
}
