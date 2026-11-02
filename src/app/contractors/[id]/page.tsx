'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';
import { countryName } from '@/lib/countries';
import { Badge, button, card, contractTerms, day, ErrorBox, ghost, input, kindLabel, Spinner, usd } from '../ui';

interface Milestone { id: string; title: string; amount: string; due_date: string | null; position: number; status: string }
interface Contract {
  id: string; title: string; scope: string | null; kind: string; rate: string | null; frequency: string | null;
  start_date: string; end_date: string | null; next_pay_date: string | null; status: string;
  business_signed_name: string | null; contractor_signed_name: string | null; contractor_signed_at: string | null;
  contractor_milestones: Milestone[];
}
interface Contractor {
  id: string; business_id: string; name: string; email: string; country: string | null; job_title: string | null; status: string;
  payout_currency: string | null; payout_wallet: string | null; payout_wallet_changed_at: string | null;
  tax_form: string | null; tax_status: string; tax_legal_name: string | null; tax_id_last4: string | null; tax_signed_at: string | null;
}
interface WorkItem { id: string; kind: string; description: string; work_date: string; minutes: number | null; amount: string; status: string; review_note: string | null; submitted_by: string }
interface Payment { id: string; amount: string; status: string; tx_hash: string | null; invoice_number: string; paid_at: string | null; payout_currency: string | null; pay_runs: { number: number } | null }

const blankContract = { title: '', scope: '', kind: 'hourly', rate: '', frequency: 'monthly', start_date: new Date().toISOString().slice(0, 10), end_date: '' };

export default function ContractorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [contractor, setContractor] = useState<Contractor | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [work, setWork] = useState<WorkItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState('');
  const [portalUrl, setPortalUrl] = useState('');
  const [showContract, setShowContract] = useState(false);
  const [draft, setDraft] = useState(blankContract);
  const [milestones, setMilestones] = useState([{ title: '', amount: '', due_date: '' }]);
  const [extra, setExtra] = useState({ contract_id: '', kind: 'bonus', amount: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    const r = await authFetch(`/api/contractors/${id}`, {}, router);
    if (r?.data.success) {
      setLoadedAt(Date.now());
      setContractor(r.data.contractor);
      setContracts(r.data.contracts);
      setWork(r.data.work_items);
      setPayments(r.data.payments);
    } else if (r) setError(r.data.error || 'Not found');
    setLoaded(true);
  }, [id, router]);
  useEffect(() => { load(); }, [load]);

  const call = async (url: string, method: string, body?: unknown) => {
    setError('');
    setBusy(true);
    const r = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }, router);
    setBusy(false);
    if (!r?.data.success) {
      setError(r?.data.error || 'Something went wrong');
      return null;
    }
    return r.data;
  };

  const createContract = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      title: draft.title,
      scope: draft.scope || null,
      kind: draft.kind,
      start_date: draft.start_date,
      end_date: draft.end_date || null,
    };
    if (draft.kind !== 'milestone') body.rate = Number(draft.rate);
    if (draft.kind === 'fixed') body.frequency = draft.frequency;
    if (draft.kind === 'milestone') {
      body.milestones = milestones.filter((m) => m.title && m.amount).map((m) => ({ title: m.title, amount: Number(m.amount), due_date: m.due_date || null }));
    }
    if (await call(`/api/contractors/${id}/contracts`, 'POST', body)) {
      setShowContract(false);
      setDraft(blankContract);
      setMilestones([{ title: '', amount: '', due_date: '' }]);
      load();
    }
  };

  const send = async (c: Contract) => {
    const signature = window.prompt(`Sign "${c.title}" as the business. Type your full name:`);
    if (!signature) return;
    if (await call(`/api/contractor-contracts/${c.id}`, 'PATCH', { action: 'send', signature })) load();
  };
  const end = async (c: Contract) => {
    const reason = window.prompt(`End "${c.title}"? Fixed fees stop after today. Reason (optional):`);
    if (reason === null) return;
    if (await call(`/api/contractor-contracts/${c.id}`, 'PATCH', { action: 'end', reason: reason || undefined })) load();
  };
  const discard = async (c: Contract) => {
    if (window.confirm(`Delete the draft "${c.title}"?`) && (await call(`/api/contractor-contracts/${c.id}`, 'DELETE'))) load();
  };
  const review = async (w: WorkItem, action: 'approve' | 'reject') => {
    const note = action === 'reject' ? window.prompt('Why are you rejecting this?') : undefined;
    if (action === 'reject' && !note) return;
    if (await call(`/api/contractor-work-items/${w.id}`, 'PATCH', { action, note: note || undefined })) load();
  };
  const addExtra = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { business_id: contractor?.business_id, contract_id: extra.contract_id, kind: extra.kind, amount: Number(extra.amount), description: extra.description };
    if (await call('/api/contractor-work-items', 'POST', body)) {
      setExtra({ ...extra, amount: '', description: '' });
      load();
    }
  };
  const newLink = async (sendEmail: boolean) => {
    const data = await call(`/api/contractors/${id}/portal-link`, 'POST', { send_email: sendEmail });
    if (data) setPortalUrl(data.url);
  };
  const verifyTax = async () => {
    if (await call(`/api/contractors/${id}`, 'PATCH', { tax_status: 'verified' })) load();
  };
  const offboard = async () => {
    if (!window.confirm(`Offboard ${contractor?.name}? Live contracts end and the portal link stops working. Records are kept.`)) return;
    if (await call(`/api/contractors/${id}`, 'DELETE')) router.push('/contractors');
  };

  if (!loaded) return <Spinner />;
  if (!contractor) {
    return (
      <div className="min-h-screen bg-gray-900 py-8 px-4"><div className="max-w-5xl mx-auto"><ErrorBox message={error || 'Not found'} /></div></div>
    );
  }

  const live = contracts.filter((c) => c.status === 'active' || c.status === 'sent');
  const recentWalletChange = contractor.payout_wallet_changed_at && loadedAt - new Date(contractor.payout_wallet_changed_at).getTime() < 72 * 3600 * 1000;

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <Link href={`/contractors?business_id=${contractor.business_id}`} className="text-purple-400 hover:text-purple-300 text-sm inline-block">← Contractors</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">{contractor.name}</h1>
            <p className="text-gray-400 mt-1">{contractor.email}{contractor.country ? ` · ${countryName(contractor.country)}` : ''}{contractor.job_title ? ` · ${contractor.job_title}` : ''}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge status={contractor.status} />
            {contractor.status !== 'offboarded' && <button onClick={offboard} className={ghost}>Offboard</button>}
          </div>
        </div>

        <ErrorBox message={error} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <section className={card}>
            <h2 className="text-sm text-gray-400">Payout wallet</h2>
            {contractor.payout_wallet ? (
              <>
                <p className="text-white mt-1">{contractor.payout_currency}</p>
                <p className="text-xs text-gray-400 break-all font-mono mt-1">{contractor.payout_wallet}</p>
                {recentWalletChange && <p className="text-xs text-amber-300 mt-2">Changed {day(contractor.payout_wallet_changed_at)}. Confirm it with them before paying.</p>}
              </>
            ) : (
              <p className="text-amber-300 mt-1 text-sm">Not set yet. The contractor adds it in their portal.</p>
            )}
          </section>
          <section className={card}>
            <h2 className="text-sm text-gray-400">Tax form</h2>
            {contractor.tax_form ? (
              <>
                <p className="text-white mt-1">{contractor.tax_form} · {contractor.tax_legal_name}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {contractor.tax_id_last4 ? `Tax id •••${contractor.tax_id_last4} · ` : ''}signed {day(contractor.tax_signed_at)}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Badge status={contractor.tax_status} />
                  {contractor.tax_status === 'submitted' && <button disabled={busy} onClick={verifyTax} className={ghost}>Mark verified</button>}
                </div>
              </>
            ) : (
              <p className="text-amber-300 mt-1 text-sm">Not submitted yet.</p>
            )}
          </section>
          <section className={card}>
            <h2 className="text-sm text-gray-400">Portal link</h2>
            <p className="text-xs text-gray-500 mt-1">A new link replaces the old one. Treat it like a password.</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button disabled={busy || contractor.status === 'offboarded'} onClick={() => newLink(true)} className={ghost}>Email new link</button>
              <button disabled={busy || contractor.status === 'offboarded'} onClick={() => newLink(false)} className={ghost}>Copy new link</button>
            </div>
            {portalUrl && <input readOnly value={portalUrl} onFocus={(e) => e.target.select()} className={`${input} mt-3 text-xs`} aria-label="Portal link" />}
          </section>
        </div>

        <section className={card}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Contracts</h2>
            {contractor.status !== 'offboarded' && <button onClick={() => setShowContract(!showContract)} className={button}>{showContract ? 'Cancel' : 'New contract'}</button>}
          </div>

          {showContract && (
            <form onSubmit={createContract} className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6 p-4 rounded-xl border border-gray-700">
              <label className="text-sm text-gray-300 sm:col-span-2">Title *<input required value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={`${input} mt-1`} /></label>
              <label className="text-sm text-gray-300">Type
                <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} className={`${input} mt-1`}>
                  <option value="hourly">Pay as you go (hourly)</option>
                  <option value="fixed">Fixed rate</option>
                  <option value="milestone">Milestones</option>
                </select>
              </label>
              {draft.kind !== 'milestone' && (
                <label className="text-sm text-gray-300">{draft.kind === 'fixed' ? 'Amount per period (USD) *' : 'Hourly rate (USD) *'}
                  <input required type="number" min="0.01" step="0.01" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} className={`${input} mt-1`} />
                </label>
              )}
              {draft.kind === 'fixed' && (
                <label className="text-sm text-gray-300">Pay every
                  <select value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value })} className={`${input} mt-1`}>
                    <option value="weekly">Week</option><option value="biweekly">Two weeks</option>
                    <option value="semimonthly">15th and month end</option><option value="monthly">Month</option>
                  </select>
                </label>
              )}
              <label className="text-sm text-gray-300">Start<input type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} className={`${input} mt-1`} /></label>
              <label className="text-sm text-gray-300">End (optional)<input type="date" value={draft.end_date} onChange={(e) => setDraft({ ...draft, end_date: e.target.value })} className={`${input} mt-1`} /></label>
              <label className="text-sm text-gray-300 sm:col-span-4">Scope of work<textarea rows={4} value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })} className={`${input} mt-1`} /></label>
              {draft.kind === 'milestone' && (
                <div className="sm:col-span-4 space-y-2">
                  {milestones.map((m, i) => (
                    <div key={i} className="grid grid-cols-6 gap-2">
                      <input aria-label="Milestone title" placeholder="Milestone" value={m.title} onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className={`${input} col-span-3`} />
                      <input aria-label="Milestone amount" placeholder="Amount" type="number" min="0.01" step="0.01" value={m.amount} onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className={`${input} col-span-1`} />
                      <input aria-label="Milestone due date" type="date" value={m.due_date} onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, due_date: e.target.value } : x)))} className={`${input} col-span-2`} />
                    </div>
                  ))}
                  <button type="button" onClick={() => setMilestones([...milestones, { title: '', amount: '', due_date: '' }])} className={ghost}>Add milestone</button>
                </div>
              )}
              <div className="sm:col-span-4"><button disabled={busy} className={button}>Save draft</button></div>
            </form>
          )}

          {contracts.length === 0 ? (
            <p className="text-gray-400">No contracts yet.</p>
          ) : (
            <ul className="space-y-4">
              {contracts.map((c) => (
                <li key={c.id} className="rounded-xl border border-gray-700 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-white font-medium">{c.title}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {contractTerms(c)} · from {day(c.start_date)}{c.end_date ? ` to ${day(c.end_date)}` : ''}
                        {c.next_pay_date && c.status === 'active' ? ` · next pay ${day(c.next_pay_date)}` : ''}
                      </p>
                      {c.contractor_signed_at && <p className="text-xs text-gray-500 mt-1">Signed by {c.business_signed_name} and {c.contractor_signed_name}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge status={c.status} label={c.status === 'sent' ? 'awaiting signature' : undefined} />
                      {c.status === 'draft' && <><button disabled={busy} onClick={() => discard(c)} className={ghost}>Delete</button><button disabled={busy} onClick={() => send(c)} className={button}>Sign &amp; send</button></>}
                      {(c.status === 'active' || c.status === 'sent') && <button disabled={busy} onClick={() => end(c)} className={ghost}>End</button>}
                    </div>
                  </div>
                  {c.scope && <p className="text-sm text-gray-300 mt-3 whitespace-pre-wrap">{c.scope}</p>}
                  {c.contractor_milestones?.length > 0 && (
                    <ul className="mt-3 text-sm divide-y divide-gray-700/60">
                      {[...c.contractor_milestones].sort((a, b) => a.position - b.position).map((m) => (
                        <li key={m.id} className="py-1.5 flex justify-between gap-2 text-gray-300">
                          <span>{m.title}{m.due_date ? ` · due ${day(m.due_date)}` : ''}</span>
                          <span className="flex items-center gap-2"><Badge status={m.status} />{usd(m.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {live.length > 0 && (
          <form onSubmit={addExtra} className={`${card} grid grid-cols-1 sm:grid-cols-6 gap-3 items-end`}>
            <p className="sm:col-span-6 text-lg font-semibold text-white">Add a bonus or reimbursement</p>
            <label className="text-sm text-gray-300 sm:col-span-2">Contract
              <select required value={extra.contract_id} onChange={(e) => setExtra({ ...extra, contract_id: e.target.value })} className={`${input} mt-1`}>
                <option value="">Choose…</option>
                {live.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            <label className="text-sm text-gray-300">Type
              <select value={extra.kind} onChange={(e) => setExtra({ ...extra, kind: e.target.value })} className={`${input} mt-1`}>
                <option value="bonus">Bonus</option><option value="expense">Expense</option>
              </select>
            </label>
            <label className="text-sm text-gray-300">Amount<input required type="number" min="0.01" step="0.01" value={extra.amount} onChange={(e) => setExtra({ ...extra, amount: e.target.value })} className={`${input} mt-1`} /></label>
            <label className="text-sm text-gray-300 sm:col-span-2">Note<input required value={extra.description} onChange={(e) => setExtra({ ...extra, description: e.target.value })} className={`${input} mt-1`} /></label>
            <p className="sm:col-span-5 text-xs text-gray-500">Approved straight away; it goes into the next pay run.</p>
            <button disabled={busy} className={button}>Add</button>
          </form>
        )}

        <section className={card}>
          <h2 className="text-lg font-semibold text-white mb-4">Work &amp; payment lines</h2>
          {work.length === 0 ? (
            <p className="text-gray-400">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-gray-700">
              {work.map((w) => (
                <li key={w.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-gray-200">{kindLabel[w.kind]}{w.minutes ? ` · ${(w.minutes / 60).toFixed(2)} h` : ''} · {w.description}</p>
                    <p className="text-xs text-gray-500">{day(w.work_date)}{w.review_note ? ` · note: ${w.review_note}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge status={w.status} />
                    <span className="text-white">{usd(w.amount)}</span>
                    {w.status === 'submitted' && <><button disabled={busy} onClick={() => review(w, 'reject')} className={ghost}>Reject</button><button disabled={busy} onClick={() => review(w, 'approve')} className={button}>Approve</button></>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card}>
          <h2 className="text-lg font-semibold text-white mb-4">Payments</h2>
          {payments.length === 0 ? (
            <p className="text-gray-400">No payments yet.</p>
          ) : (
            <ul className="divide-y divide-gray-700">
              {payments.map((p) => (
                <li key={p.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div>
                    <p className="text-gray-200">{p.invoice_number} · pay run #{p.pay_runs?.number}</p>
                    <p className="text-xs text-gray-500 break-all">{p.paid_at ? `Paid ${day(p.paid_at)}` : ''}{p.payout_currency ? ` · ${p.payout_currency}` : ''}{p.tx_hash ? ` · ${p.tx_hash}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2"><Badge status={p.status} /><span className="text-white">{usd(p.amount)}</span></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
