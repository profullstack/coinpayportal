'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CountrySelect } from '@/components/CountrySelect';
import { countryName } from '@/lib/countries';
import { authFetch, getAuthToken } from '@/lib/auth/client';
import { Badge, button, card, day, ErrorBox, ghost, input, kindLabel, Spinner, usd } from './ui';

interface Business { id: string; name: string }
interface Contractor {
  id: string; name: string; email: string; country: string | null; job_title: string | null; status: string;
  payout_currency: string | null; payout_wallet: string | null; tax_form: string | null; tax_status: string;
  pending_approvals: number;
}
interface WorkItem {
  id: string; kind: string; description: string; work_date: string; minutes: number | null; amount: string;
  receipt_url: string | null; status: string; contractors: { name: string } | null;
  contractor_contracts: { title: string } | null;
}
interface PayRun { id: string; number: number; pay_date: string; status: string; total: string; auto_drafted: boolean; contractors: number; paid: number }
interface TaxRow { contractor_id: string; name: string; tax_form: string | null; tax_id_last4: string | null; total_paid: number; needs_1099_nec: boolean; missing_w9: boolean }

type Tab = 'people' | 'approvals' | 'payruns' | 'tax';
const emptyForm = { name: '', email: '', country: '', job_title: '' };

export default function ContractorsPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [tab, setTab] = useState<Tab>('people');
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [pending, setPending] = useState<WorkItem[]>([]);
  const [runs, setRuns] = useState<PayRun[]>([]);
  const [taxYear, setTaxYear] = useState(new Date().getUTCFullYear());
  const [tax, setTax] = useState<TaxRow[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const result = await authFetch('/api/businesses', {}, router);
      if (result?.data.success && result.data.businesses.length > 0) {
        setBusinesses(result.data.businesses);
        const wanted = new URLSearchParams(window.location.search).get('business_id');
        const match = result.data.businesses.find((b: Business) => b.id === wanted);
        setBusinessId(match?.id ?? result.data.businesses[0].id);
      }
      const t = new URLSearchParams(window.location.search).get('tab') as Tab | null;
      if (t && ['people', 'approvals', 'payruns', 'tax'].includes(t)) setTab(t);
      setLoading(false);
    })();
  }, [router]);

  const load = useCallback(async () => {
    if (!businessId) return;
    const [c, w, r] = await Promise.all([
      authFetch(`/api/contractors?business_id=${businessId}`, {}, router),
      authFetch(`/api/contractor-work-items?business_id=${businessId}&status=submitted`, {}, router),
      authFetch(`/api/pay-runs?business_id=${businessId}`, {}, router),
    ]);
    setContractors(c?.data.success ? c.data.contractors : []);
    setPending(w?.data.success ? w.data.work_items : []);
    setRuns(r?.data.success ? r.data.pay_runs : []);
  }, [businessId, router]);

  const loadTax = useCallback(async () => {
    if (!businessId) return;
    const t = await authFetch(`/api/contractors/1099?business_id=${businessId}&year=${taxYear}`, {}, router);
    setTax(t?.data.success ? t.data.contractors : []);
  }, [businessId, taxYear, router]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === 'tax') loadTax(); }, [tab, loadTax]);

  const post = async (url: string, body: unknown, method = 'POST') => {
    setError('');
    setNotice('');
    setBusy(true);
    const result = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, router);
    setBusy(false);
    if (!result?.data.success) {
      setError(result?.data.error || 'Something went wrong');
      return null;
    }
    return result.data;
  };

  const addContractor = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = await post('/api/contractors', {
      business_id: businessId,
      name: form.name,
      email: form.email,
      country: form.country || null,
      job_title: form.job_title || null,
    });
    if (!data) return;
    setForm(emptyForm);
    router.push(`/contractors/${data.contractor.id}`);
  };

  const review = async (id: string, action: 'approve' | 'reject') => {
    const note = action === 'reject' ? window.prompt('Why are you rejecting this? The contractor will see your note.') : undefined;
    if (action === 'reject' && !note) return;
    if (await post(`/api/contractor-work-items/${id}`, { action, note: note || undefined }, 'PATCH')) load();
  };

  const newRun = async () => {
    const data = await post('/api/pay-runs', { business_id: businessId });
    if (data) router.push(`/contractors/pay-runs/${data.pay_run.id}`);
  };

  const downloadCsv = async () => {
    setError('');
    const res = await fetch(`/api/contractors/1099?business_id=${businessId}&year=${taxYear}&format=csv`, {
      headers: { Authorization: `Bearer ${getAuthToken() ?? ''}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || 'Download failed');
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `contractors-1099-${taxYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <Spinner />;

  const approvedQueue = runs.filter((r) => r.status === 'draft').length;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'people', label: `People (${contractors.length})` },
    { id: 'approvals', label: `Approvals${pending.length ? ` (${pending.length})` : ''}` },
    { id: 'payruns', label: `Pay runs${approvedQueue ? ` (${approvedQueue} draft)` : ''}` },
    { id: 'tax', label: 'Tax forms & 1099' },
  ];

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">Contractors</h1>
            <p className="mt-2 text-gray-400 max-w-2xl">
              Hire contractors anywhere, sign contracts, collect W-9 and W-8 forms, approve their hours and milestones,
              and pay the whole team in crypto in one pay run.
            </p>
          </div>
          {businesses.length > 1 && (
            <select aria-label="Business" value={businessId} onChange={(e) => setBusinessId(e.target.value)} className="px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white">
              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>

        {businesses.length === 0 && (
          <div className={card}>
            <p className="text-gray-300">Create a business first; contractors are paid from a business.</p>
            <Link href="/businesses" className={`${button} inline-block mt-4`}>Create a business</Link>
          </div>
        )}

        <ErrorBox message={error} />
        {notice && <div className="bg-green-500/10 border border-green-500/30 text-green-300 px-4 py-3 rounded-lg text-sm">{notice}</div>}

        <nav className="flex flex-wrap gap-2 border-b border-gray-700" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === t.id ? 'border-purple-400 text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'people' && (
          <>
            <form onSubmit={addContractor} className={`${card} grid grid-cols-1 sm:grid-cols-5 gap-3 items-end`}>
              <label className="text-sm text-gray-300 sm:col-span-1">
                Name *
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${input} mt-1`} />
              </label>
              <label className="text-sm text-gray-300 sm:col-span-2">
                Email *
                <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`${input} mt-1`} />
              </label>
              <label className="text-sm text-gray-300">
                Country
                <CountrySelect value={form.country} onChange={(country) => setForm({ ...form, country })} placeholder="e.g. Nigeria" className={`${input} mt-1`} />
              </label>
              <button disabled={busy || !businessId} className={button}>Invite</button>
              <p className="sm:col-span-5 text-xs text-gray-500">
                They get an email with a private portal link to add their wallet, fill in their tax form and sign contracts. No account needed.
              </p>
            </form>

            <section className={card}>
              {contractors.length === 0 ? (
                <p className="text-gray-400">No contractors yet. Invite your first one above.</p>
              ) : (
                <ul className="divide-y divide-gray-700">
                  {contractors.map((c) => (
                    <li key={c.id}>
                      <Link href={`/contractors/${c.id}`} className="py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-gray-800/60 rounded-lg px-2 -mx-2">
                        <div className="min-w-0">
                          <p className="text-white font-medium">{c.name}</p>
                          <p className="text-xs text-gray-500">{c.email}{c.country ? ` · ${countryName(c.country)}` : ''}{c.job_title ? ` · ${c.job_title}` : ''}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {c.pending_approvals > 0 && <Badge status="submitted" label={`${c.pending_approvals} to approve`} />}
                          <Badge status={c.payout_wallet ? 'active' : 'missing'} label={c.payout_wallet ? c.payout_currency ?? 'wallet' : 'no wallet'} />
                          <Badge status={c.tax_status} label={c.tax_form ? `${c.tax_form} ${c.tax_status}` : 'tax form missing'} />
                          <Badge status={c.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {tab === 'approvals' && (
          <section className={card}>
            <h2 className="text-lg font-semibold text-white mb-4">Waiting for approval</h2>
            {pending.length === 0 ? (
              <p className="text-gray-400">Nothing to review. Hours, milestones and expenses your contractors submit show up here.</p>
            ) : (
              <ul className="divide-y divide-gray-700">
                {pending.map((w) => (
                  <li key={w.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white">
                        <span className="font-medium">{w.contractors?.name}</span> · {kindLabel[w.kind]}
                        {w.minutes ? ` · ${(w.minutes / 60).toFixed(2)} h` : ''}
                      </p>
                      <p className="text-xs text-gray-500">
                        {w.contractor_contracts?.title} · {day(w.work_date)} · {w.description}
                        {w.receipt_url && (
                          <> · <a href={w.receipt_url} target="_blank" rel="noopener noreferrer" className="text-purple-400">receipt</a></>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-white mr-2">{usd(w.amount)}</span>
                      <button disabled={busy} onClick={() => review(w.id, 'reject')} className={ghost}>Reject</button>
                      <button disabled={busy} onClick={() => review(w.id, 'approve')} className={button}>Approve</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'payruns' && (
          <section className={card}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Pay runs</h2>
                <p className="text-xs text-gray-500">
                  A run collects fixed fees that are due plus all approved work. Fixed-fee runs are drafted automatically on the pay date;
                  nothing is sent until the owner presses Pay.
                </p>
              </div>
              <button disabled={busy || !businessId} onClick={newRun} className={button}>New pay run</button>
            </div>
            {runs.length === 0 ? (
              <p className="text-gray-400">No pay runs yet.</p>
            ) : (
              <ul className="divide-y divide-gray-700">
                {runs.map((r) => (
                  <li key={r.id}>
                    <Link href={`/contractors/pay-runs/${r.id}`} className="py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-gray-800/60 rounded-lg px-2 -mx-2">
                      <div>
                        <p className="text-white font-medium">Pay run #{r.number}{r.auto_drafted ? ' (scheduled)' : ''}</p>
                        <p className="text-xs text-gray-500">Pay date {day(r.pay_date)} · {r.paid}/{r.contractors} paid</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge status={r.status} />
                        <span className="text-white">{usd(r.total)}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'tax' && (
          <section className={card}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">1099-NEC summary</h2>
                <p className="text-xs text-gray-500">
                  Paid per contractor in the calendar year. US non-corporate contractors paid $600 or more need a 1099-NEC.
                  The CSV for filing includes full tax ids and is available to the owner only.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select aria-label="Tax year" value={taxYear} onChange={(e) => setTaxYear(Number(e.target.value))} className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm">
                  {[0, 1, 2, 3].map((n) => {
                    const y = new Date().getUTCFullYear() - n;
                    return <option key={y} value={y}>{y}</option>;
                  })}
                </select>
                <button onClick={downloadCsv} className={ghost}>Download CSV</button>
              </div>
            </div>
            {tax.length === 0 ? (
              <p className="text-gray-400">No contractor payments in {taxYear}.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-gray-400">
                  <tr><th className="py-2">Contractor</th><th>Form</th><th>Tax id</th><th className="text-right">Paid</th><th className="text-right">1099-NEC</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-700 text-gray-200">
                  {tax.map((t) => (
                    <tr key={t.contractor_id}>
                      <td className="py-2">{t.name}</td>
                      <td>{t.tax_form ?? <span className="text-amber-300">missing</span>}</td>
                      <td>{t.tax_id_last4 ? `•••${t.tax_id_last4}` : ''}</td>
                      <td className="text-right">{usd(t.total_paid)}</td>
                      <td className="text-right">
                        {t.needs_1099_nec ? <Badge status="submitted" label="file" /> : t.missing_w9 ? <Badge status="missing" label="get a W-9" /> : <span className="text-gray-500">no</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
