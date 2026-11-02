'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CountrySelect } from '@/components/CountrySelect';
import { Badge, button, card, contractTerms, day, ErrorBox, ghost, input, kindLabel, Spinner, usd } from '@/app/contractors/ui';

const COINS = ['USDC_SOL', 'USDC_POL', 'USDC_ETH', 'USDT_SOL', 'USDT_POL', 'USDT_ETH', 'BTC', 'ETH', 'SOL', 'POL', 'BNB', 'XRP', 'ADA', 'DOGE', 'BCH'];

interface Milestone { id: string; title: string; amount: string; due_date: string | null; position: number; status: string }
interface Contract {
  id: string; title: string; scope: string | null; kind: string; rate: string | null; frequency: string | null; start_date: string;
  end_date: string | null; next_pay_date: string | null; notice_days: number; status: string; business_signed_name: string | null;
  business_signed_at: string | null; contractor_signed_name: string | null; contractor_signed_at: string | null; contractor_milestones: Milestone[];
}
interface WorkItem { id: string; contract_id: string; kind: string; description: string; work_date: string; minutes: number | null; amount: string; status: string; review_note: string | null; submitted_by: string }
interface Payment { id: string; amount: string; payout_currency: string | null; tx_hash: string | null; invoice_number: string; paid_at: string }
interface Portal {
  contractor: { name: string; email: string; payout_currency: string | null; payout_wallet: string | null; tax_form: string | null; tax_status: string; tax_legal_name: string | null; tax_id_last4: string | null; country: string | null };
  business: { name: string };
  brand: { color: string | null; logo_url: string | null };
  contracts: Contract[];
  work_items: WorkItem[];
  payments: Payment[];
}

const today = () => new Date().toISOString().slice(0, 10);

export default function ContractorPortal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [portal, setPortal] = useState<Portal | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState({ payout_currency: 'USDC_SOL', payout_wallet: '' });
  const [taxOpen, setTaxOpen] = useState(false);
  const [tax, setTax] = useState({ tax_form: 'W9', legal_name: '', business_name: '', classification: 'individual', address: '', country: 'US', tax_id: '', signature: '', certify: false });
  const [hours, setHours] = useState({ contract_id: '', work_date: today(), hours: '', description: '' });
  const [expense, setExpense] = useState({ contract_id: '', amount: '', description: '', receipt_url: '' });

  const load = useCallback(async () => {
    const res = await fetch(`/api/contractor-portal/${token}`, { cache: 'no-store' });
    if (res.status === 404) return setMissing(true);
    const data = await res.json();
    if (!data.success) return setError(data.error);
    setPortal(data);
    if (data.contractor.payout_wallet) setWallet({ payout_currency: data.contractor.payout_currency, payout_wallet: data.contractor.payout_wallet });
    if (data.contractor.country) setTax((t) => ({ ...t, country: data.contractor.country, tax_form: data.contractor.country === 'US' ? 'W9' : 'W8BEN' }));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const act = async (body: Record<string, unknown>, done: string) => {
    setError('');
    setNotice('');
    setBusy(true);
    const res = await fetch(`/api/contractor-portal/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({ success: false, error: 'Something went wrong' }));
    setBusy(false);
    if (!data.success) {
      setError(data.error || 'Something went wrong');
      return false;
    }
    setNotice(done);
    await load();
    return true;
  };

  if (missing) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className={`${card} max-w-md text-center`}>
          <h1 className="text-xl text-white font-semibold">This link no longer works</h1>
          <p className="text-gray-400 mt-2">Ask the business that pays you to send a new portal link.</p>
        </div>
      </div>
    );
  }
  if (!portal) return <Spinner />;

  const { contractor, business, contracts, work_items, payments } = portal;
  const accent = portal.brand.color && /^#[0-9a-fA-F]{6}$/.test(portal.brand.color) ? portal.brand.color : null;
  const logo = portal.brand.logo_url && /^https:\/\//.test(portal.brand.logo_url) ? portal.brand.logo_url : null;
  const active = contracts.filter((c) => c.status === 'active');
  const hourly = active.filter((c) => c.kind === 'hourly');
  const toSign = contracts.filter((c) => c.status === 'sent');
  const steps = [
    { done: Boolean(contractor.payout_wallet), label: 'Add the wallet you want to be paid to' },
    { done: Boolean(contractor.tax_form), label: 'Fill in your tax form (W-9 or W-8)' },
    { done: toSign.length === 0 && contracts.length > 0, label: contracts.length ? 'Sign your contract' : 'Wait for your contract' },
  ];
  const paidTotal = payments.reduce((s, p) => s + Number(p.amount), 0);
  const pendingTotal = work_items.filter((w) => w.status === 'submitted' || w.status === 'approved').reduce((s, w) => s + Number(w.amount), 0);

  return (
    <div className="min-h-screen bg-gray-900 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="text-center">
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element -- merchant logo on an arbitrary https host
            <img src={logo} alt={business.name} className="mx-auto mb-4 max-h-14 max-w-[240px] object-contain" referrerPolicy="no-referrer" />
          )}
          <h1 className="text-2xl font-bold text-white">{business.name}</h1>
          <p className="text-gray-400 mt-1">Contractor portal for {contractor.name}</p>
        </header>

        <ErrorBox message={error} />
        {notice && <div className="bg-green-500/10 border border-green-500/30 text-green-300 px-4 py-3 rounded-lg text-sm">{notice}</div>}

        <section className={`${card} grid grid-cols-2 gap-4`}>
          {accent && <div className="col-span-2 h-1.5 -mt-6 -mx-6 rounded-t-2xl" style={{ backgroundColor: accent }} />}
          <div><p className="text-sm text-gray-400">Paid to you</p><p className="text-2xl font-semibold text-white">{usd(paidTotal)}</p></div>
          <div><p className="text-sm text-gray-400">Submitted, not yet paid</p><p className="text-2xl font-semibold text-white">{usd(pendingTotal)}</p></div>
        </section>

        {steps.some((s) => !s.done) && (
          <section className={card}>
            <h2 className="text-lg font-semibold text-white mb-3">Get set up</h2>
            <ol className="space-y-2">
              {steps.map((s) => (
                <li key={s.label} className={`flex items-center gap-2 text-sm ${s.done ? 'text-green-300' : 'text-gray-200'}`}>
                  <span aria-hidden>{s.done ? '✓' : '○'}</span>{s.label}
                </li>
              ))}
            </ol>
          </section>
        )}

        {toSign.map((c) => (
          <section key={c.id} className={`${card} border-purple-500/50`}>
            <p className="text-xs uppercase tracking-wide text-purple-300">Contract to sign</p>
            <h2 className="text-lg font-semibold text-white mt-1">{c.title}</h2>
            <p className="text-sm text-gray-300 mt-1">{contractTerms(c)} · starts {day(c.start_date)}{c.end_date ? ` · ends ${day(c.end_date)}` : ''}{c.notice_days ? ` · ${c.notice_days} days notice` : ''}</p>
            {c.scope && <p className="text-sm text-gray-300 mt-3 whitespace-pre-wrap">{c.scope}</p>}
            {c.contractor_milestones.length > 0 && (
              <ul className="mt-3 text-sm text-gray-300 list-disc pl-5">{c.contractor_milestones.map((m) => <li key={m.id}>{m.title}: {usd(m.amount)}{m.due_date ? `, due ${day(m.due_date)}` : ''}</li>)}</ul>
            )}
            <p className="text-xs text-gray-500 mt-3">Signed for {business.name} by {c.business_signed_name} on {day(c.business_signed_at)}. You work as an independent contractor, not an employee.</p>
            <form
              className="mt-4 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const signature = String(new FormData(e.currentTarget).get('signature') || '');
                act({ action: 'sign', contract_id: c.id, signature }, 'Contract signed. You can now log work against it.');
              }}
            >
              <input name="signature" required minLength={2} placeholder="Type your full name to sign" className={`${input} flex-1 min-w-[220px]`} aria-label="Signature" />
              <button disabled={busy} className={button}>Sign contract</button>
            </form>
          </section>
        ))}

        <section className={card}>
          <h2 className="text-lg font-semibold text-white mb-1">Payout wallet</h2>
          <p className="text-xs text-gray-500 mb-3">Where {business.name} sends your pay. Changing it notifies you and the business, and it is flagged on the next pay run.</p>
          <form
            className="grid grid-cols-1 sm:grid-cols-4 gap-2"
            onSubmit={(e) => { e.preventDefault(); act({ action: 'payout', ...wallet }, 'Payout wallet saved.'); }}
          >
            <select aria-label="Coin" value={wallet.payout_currency} onChange={(e) => setWallet({ ...wallet, payout_currency: e.target.value })} className={input}>
              {COINS.map((c) => <option key={c} value={c}>{c.replace('_', ' on ')}</option>)}
            </select>
            <input aria-label="Wallet address" required placeholder="Wallet address" value={wallet.payout_wallet} onChange={(e) => setWallet({ ...wallet, payout_wallet: e.target.value.trim() })} className={`${input} sm:col-span-2 font-mono`} />
            <button disabled={busy} className={button}>Save wallet</button>
          </form>
        </section>

        <section className={card}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Tax form</h2>
              {contractor.tax_form ? (
                <p className="text-sm text-gray-300 mt-1">{contractor.tax_form} for {contractor.tax_legal_name}{contractor.tax_id_last4 ? ` · •••${contractor.tax_id_last4}` : ''} <Badge status={contractor.tax_status} /></p>
              ) : (
                <p className="text-sm text-amber-300 mt-1">Required before your first payment.</p>
              )}
            </div>
            <button onClick={() => setTaxOpen(!taxOpen)} className={ghost}>{taxOpen ? 'Close' : contractor.tax_form ? 'Update' : 'Fill in'}</button>
          </div>
          {taxOpen && (
            <form
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const body: Record<string, unknown> = { action: 'tax_form', ...tax, business_name: tax.business_name || null };
                if (!tax.tax_id) delete body.tax_id;
                if (tax.tax_form !== 'W9' && tax.tax_form !== 'W8BENE') delete body.classification;
                if (await act(body, 'Tax form submitted. Only the last four of your tax id are ever shown.')) setTaxOpen(false);
              }}
            >
              <label className="text-sm text-gray-300">Form
                <select value={tax.tax_form} onChange={(e) => setTax({ ...tax, tax_form: e.target.value, classification: e.target.value === 'W8BENE' ? 'foreign_entity' : 'individual' })} className={`${input} mt-1`}>
                  <option value="W9">W-9 (US person or US company)</option>
                  <option value="W8BEN">W-8BEN (non-US individual)</option>
                  <option value="W8BENE">W-8BEN-E (non-US company)</option>
                </select>
              </label>
              <label className="text-sm text-gray-300">Legal name *<input required value={tax.legal_name} onChange={(e) => setTax({ ...tax, legal_name: e.target.value })} className={`${input} mt-1`} /></label>
              <label className="text-sm text-gray-300">Business name (if different)<input value={tax.business_name} onChange={(e) => setTax({ ...tax, business_name: e.target.value })} className={`${input} mt-1`} /></label>
              {tax.tax_form === 'W9' && (
                <label className="text-sm text-gray-300">Tax classification
                  <select value={tax.classification} onChange={(e) => setTax({ ...tax, classification: e.target.value })} className={`${input} mt-1`}>
                    <option value="individual">Individual</option><option value="sole_proprietor">Sole proprietor</option><option value="llc">LLC</option>
                    <option value="c_corp">C corporation</option><option value="s_corp">S corporation</option><option value="partnership">Partnership</option><option value="trust">Trust / estate</option>
                  </select>
                </label>
              )}
              <label className="text-sm text-gray-300 sm:col-span-2">Address *<input required minLength={5} value={tax.address} onChange={(e) => setTax({ ...tax, address: e.target.value })} className={`${input} mt-1`} /></label>
              <label className="text-sm text-gray-300">Country *<CountrySelect required value={tax.country} onChange={(country) => setTax({ ...tax, country })} className={`${input} mt-1`} /></label>
              <label className="text-sm text-gray-300">{tax.tax_form === 'W9' ? 'SSN or EIN *' : 'Foreign tax id (optional)'}
                <input required={tax.tax_form === 'W9'} autoComplete="off" value={tax.tax_id} onChange={(e) => setTax({ ...tax, tax_id: e.target.value })} className={`${input} mt-1`} />
              </label>
              <label className="sm:col-span-2 flex items-start gap-2 text-xs text-gray-400">
                <input type="checkbox" checked={tax.certify} onChange={(e) => setTax({ ...tax, certify: e.target.checked })} className="mt-0.5" />
                Under penalties of perjury, I certify that the information on this form is true, correct and complete
                {tax.tax_form === 'W9' ? ', and that I am a U.S. person' : ', and that I am not a U.S. person'}.
              </label>
              <label className="text-sm text-gray-300">Signature (type your legal name) *<input required value={tax.signature} onChange={(e) => setTax({ ...tax, signature: e.target.value })} className={`${input} mt-1`} /></label>
              <div className="flex items-end"><button disabled={busy || !tax.certify} className={button}>Sign and submit</button></div>
            </form>
          )}
        </section>

        {hourly.length > 0 && (
          <section className={card}>
            <h2 className="text-lg font-semibold text-white mb-3">Log hours</h2>
            <form
              className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end"
              onSubmit={async (e) => {
                e.preventDefault();
                const minutes = Math.round(Number(hours.hours) * 60);
                const ok = await act({ action: 'hours', contract_id: hours.contract_id || hourly[0].id, work_date: hours.work_date, minutes, description: hours.description }, 'Hours submitted for approval.');
                if (ok) setHours({ ...hours, hours: '', description: '' });
              }}
            >
              {hourly.length > 1 && (
                <select aria-label="Contract" value={hours.contract_id} onChange={(e) => setHours({ ...hours, contract_id: e.target.value })} className={`${input} sm:col-span-2`}>
                  {hourly.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              )}
              <input aria-label="Date" type="date" max={today()} value={hours.work_date} onChange={(e) => setHours({ ...hours, work_date: e.target.value })} className={input} />
              <input aria-label="Hours" required type="number" min="0.25" max="24" step="0.25" placeholder="Hours" value={hours.hours} onChange={(e) => setHours({ ...hours, hours: e.target.value })} className={input} />
              <input aria-label="What you worked on" required placeholder="What you worked on" value={hours.description} onChange={(e) => setHours({ ...hours, description: e.target.value })} className={`${input} ${hourly.length > 1 ? 'sm:col-span-1' : 'sm:col-span-3'}`} />
              <button disabled={busy} className={button}>Submit</button>
            </form>
          </section>
        )}

        {active.filter((c) => c.contractor_milestones.length > 0).map((c) => (
          <section key={c.id} className={card}>
            <h2 className="text-lg font-semibold text-white mb-3">Milestones · {c.title}</h2>
            <ul className="divide-y divide-gray-700">
              {[...c.contractor_milestones].sort((a, b) => a.position - b.position).map((m) => (
                <li key={m.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="text-gray-200">{m.title}{m.due_date ? <span className="text-gray-500"> · due {day(m.due_date)}</span> : ''}</span>
                  <span className="flex items-center gap-2">
                    <Badge status={m.status} />
                    <span className="text-white">{usd(m.amount)}</span>
                    {m.status === 'pending' && (
                      <button disabled={busy} onClick={() => act({ action: 'milestone', milestone_id: m.id }, 'Milestone submitted for approval.')} className={ghost}>Mark complete</button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {active.length > 0 && (
          <section className={card}>
            <h2 className="text-lg font-semibold text-white mb-3">Claim an expense</h2>
            <form
              className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await act(
                  { action: 'expense', contract_id: expense.contract_id || active[0].id, amount: Number(expense.amount), description: expense.description, ...(expense.receipt_url ? { receipt_url: expense.receipt_url } : {}) },
                  'Expense submitted for approval.'
                );
                if (ok) setExpense({ ...expense, amount: '', description: '', receipt_url: '' });
              }}
            >
              {active.length > 1 && (
                <select aria-label="Contract" value={expense.contract_id} onChange={(e) => setExpense({ ...expense, contract_id: e.target.value })} className={`${input} sm:col-span-2`}>
                  {active.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              )}
              <input aria-label="Amount" required type="number" min="0.01" step="0.01" placeholder="Amount (USD)" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} className={input} />
              <input aria-label="Expense description" required placeholder="What it was for" value={expense.description} onChange={(e) => setExpense({ ...expense, description: e.target.value })} className={`${input} sm:col-span-2`} />
              <input aria-label="Receipt link" type="url" pattern="https://.*" placeholder="Receipt link (https)" value={expense.receipt_url} onChange={(e) => setExpense({ ...expense, receipt_url: e.target.value })} className={`${input} ${active.length > 1 ? '' : 'sm:col-span-2'}`} />
              <button disabled={busy} className={button}>Submit</button>
            </form>
          </section>
        )}

        {work_items.length > 0 && (
          <section className={card}>
            <h2 className="text-lg font-semibold text-white mb-3">Your submissions</h2>
            <ul className="divide-y divide-gray-700">
              {work_items.map((w) => (
                <li key={w.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-gray-200">{kindLabel[w.kind]}{w.minutes ? ` · ${(w.minutes / 60).toFixed(2)} h` : ''} · {w.description}</p>
                    <p className="text-xs text-gray-500">{day(w.work_date)}{w.review_note ? ` · ${w.review_note}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge status={w.status} />
                    <span className="text-white">{usd(w.amount)}</span>
                    {w.status === 'submitted' && w.submitted_by === 'contractor' && (
                      <button disabled={busy} onClick={() => act({ action: 'withdraw', work_item_id: w.id }, 'Submission withdrawn.')} className={ghost}>Withdraw</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={card}>
          <h2 className="text-lg font-semibold text-white mb-3">Payments &amp; invoices</h2>
          {payments.length === 0 ? (
            <p className="text-gray-400 text-sm">No payments yet. Each payment comes with an invoice generated for you.</p>
          ) : (
            <ul className="divide-y divide-gray-700">
              {payments.map((p) => (
                <li key={p.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-gray-200">{p.invoice_number} · {day(p.paid_at)}{p.payout_currency ? ` · ${p.payout_currency}` : ''}</p>
                    {p.tx_hash && <p className="text-xs text-gray-500 break-all">{p.tx_hash}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-white">{usd(p.amount)}</span>
                    <Link href={`/contractor/${token}/invoices/${p.id}`} className={ghost}>Invoice</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="text-center text-sm text-gray-500">
          Payments by <Link href="/" className="text-purple-400 hover:text-purple-300">CoinPay</Link>. Keep this link private.
        </footer>
      </div>
    </div>
  );
}
