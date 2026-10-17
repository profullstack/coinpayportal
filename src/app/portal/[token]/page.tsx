import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serviceClient } from '@/lib/invoices/catalog';
import { loadPortal } from '@/lib/invoices/portal';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your invoices',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const statusStyle: Record<string, string> = {
  sent: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  overdue: 'bg-red-500/20 text-red-300 border-red-500/30',
  paid: 'bg-green-500/20 text-green-300 border-green-500/30',
};

const money = (amount: number | string, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' }) : '');

/** A client's own view of everything a business has invoiced them. */
export default async function ClientPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const portal = await loadPortal(serviceClient(), token);
  if (!portal) notFound();

  const accent = portal.brand.color && /^#[0-9a-fA-F]{6}$/.test(portal.brand.color) ? portal.brand.color : null;
  const logo = portal.brand.logo_url && /^https:\/\//.test(portal.brand.logo_url) ? portal.brand.logo_url : null;
  const open = portal.invoices.filter((i) => i.status !== 'paid');
  const paid = portal.invoices.filter((i) => i.status === 'paid');

  return (
    <div className="min-h-screen bg-gray-900 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="text-center">
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element -- merchant logo on an arbitrary https host
            <img src={logo} alt={portal.business.name || 'Logo'} className="mx-auto mb-4 max-h-14 max-w-[240px] object-contain" referrerPolicy="no-referrer" />
          )}
          <h1 className="text-2xl font-bold text-white">{portal.business.name || 'Your invoices'}</h1>
          {portal.client.name && <p className="text-gray-400 mt-1">Invoices for {portal.client.name}</p>}
        </header>

        <section className="bg-gray-800/50 rounded-2xl border border-gray-700 overflow-hidden">
          {accent && <div className="h-1.5" style={{ backgroundColor: accent }} />}
          <div className="p-6">
            <p className="text-sm text-gray-400">Outstanding</p>
            {portal.outstanding.length === 0 ? (
              <p className="text-2xl font-semibold text-green-400 mt-1">All paid. Thank you!</p>
            ) : (
              <div className="flex flex-wrap gap-x-6 mt-1">
                {portal.outstanding.map((o) => (
                  <p key={o.currency} className="text-2xl font-semibold text-white">
                    {money(o.amount, o.currency)}
                  </p>
                ))}
              </div>
            )}
          </div>
        </section>

        {[
          { title: 'Open invoices', rows: open },
          { title: 'Paid', rows: paid },
        ].map(
          (group) =>
            group.rows.length > 0 && (
              <section key={group.title} className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6">
                <h2 className="text-lg font-semibold text-white mb-4">{group.title}</h2>
                <ul className="divide-y divide-gray-700">
                  {group.rows.map((inv) => (
                    <li key={inv.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-white font-medium">{inv.invoice_number}</p>
                        <p className="text-xs text-gray-500">
                          Issued {day(inv.created_at)}
                          {inv.status === 'paid' ? ` · Paid ${day(inv.paid_at)}` : inv.due_date ? ` · Due ${day(inv.due_date)}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 text-xs rounded-full border ${statusStyle[inv.status] ?? ''}`}>
                          {inv.status}
                        </span>
                        <span className="text-white">{money(inv.amount, inv.currency)}</span>
                        <Link
                          href={`/invoices/${inv.id}/pay`}
                          className="px-3 py-1.5 text-sm rounded-lg text-white bg-purple-600 hover:bg-purple-500"
                          style={accent ? { backgroundColor: accent } : undefined}
                        >
                          {inv.status === 'paid' ? 'View' : 'Pay'}
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )
        )}

        {portal.invoices.length === 0 && <p className="text-center text-gray-500">No invoices yet.</p>}

        <footer className="text-center text-sm text-gray-500 space-y-2">
          {portal.brand.footer && <p className="whitespace-pre-wrap text-gray-400">{portal.brand.footer}</p>}
          <p>
            Payments by <Link href="/" className="text-purple-400 hover:text-purple-300">CoinPay</Link>
          </p>
        </footer>
      </div>
    </div>
  );
}
