'use client';

import { useRef, useState, type FormEvent } from 'react';
import { GUIDE_PATH, SUPPORT_EMAIL, SUPPORT_PHONE, CONTACT_URL } from '@/lib/field-guide/lead.mjs';

type Delivery = { downloadUrl: string; emailAccepted: boolean };
export function GuideForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const busy = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true; setLoading(true); setError('');
    const form = new FormData(event.currentTarget);
    const query = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const value = query.get(k); if (value) utm[k] = value.slice(0, 120);
    }
    try {
      const response = await fetch('/api/field-guide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.get('name'), email: form.get('email'), company: form.get('company'), region: form.get('region'), role: form.get('role') || '', website: form.get('website') || '', privacyAccepted: form.get('privacyAccepted') === 'on', marketingConsent: form.get('marketingConsent') === 'on', consultationInterest: form.get('consultationInterest') === 'on', source: query.get('source'), utm }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Your request could not be completed.');
      if (data.downloadUrl !== GUIDE_PATH) throw new Error('Unexpected download response. Please contact support.');
      setDelivery({ downloadUrl: data.downloadUrl, emailAccepted: data.emailAccepted === true });
      const link = document.createElement('a');
      link.href = GUIDE_PATH; link.download = GUIDE_PATH.split('/').pop() || 'coinpay-guide.pdf';
      document.body.appendChild(link); link.click(); link.remove();
    } catch (err) { setError(err instanceof Error ? err.message : 'Please try again later.'); }
    finally { busy.current = false; setLoading(false); }
  }
  const inputClass = 'mt-1 w-full rounded-lg border border-[#c8cdc7] bg-white px-3 py-2.5 text-[#203b2f] focus:outline-none focus:ring-2 focus:ring-[#9b4d2b]';
  return (
    <div className="rounded-xl border border-[#d6d4cb] bg-white p-6 shadow-sm sm:p-8">
      {delivery ? (
        <div role="status" aria-live="polite">
          <h2 className="font-serif text-3xl">Your guide is ready.</h2>
          <p className="my-4 text-sm leading-relaxed">The download should start automatically. {delivery.emailAccepted ? 'The email provider also accepted your delivery email. Check your inbox and spam folder.' : 'We could not send the email copy. Your PDF is still available below.'}</p>
          <a href={delivery.downloadUrl} download className="inline-block rounded-lg bg-[#203b2f] px-5 py-3 font-semibold text-white">Download the PDF</a>
          <div className="mt-8 border-t border-[#d6d4cb] pt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#9b4d2b]">Your region. Your business.</p>
            <h3 className="mt-2 font-serif text-2xl">Make the next step specific to you.</h3>
            <p className="mt-3 text-sm leading-relaxed">Book a call about your location, business workflows, and a scoped implementation plan. Calls and implementation services are optional and separately agreed. Tax and legal advice require appropriately licensed professionals.</p>
            <a href={CONTACT_URL} className="mt-4 inline-block font-semibold underline underline-offset-4">Book a regional setup call</a>
            <p className="mt-3 text-sm"><a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a><br /><a href="tel:+18885264640">{SUPPORT_PHONE}</a></p>
          </div>
        </div>
      ) : (
        <>
          <h2 className="font-serif text-3xl">Get the free guide.</h2>
          <p className="mt-2 text-sm leading-relaxed">Tell us about your business to unlock the PDF. We will also attempt to email the download link. No payment or CoinPay account is required.</p>
          <form onSubmit={submit} className="mt-6 space-y-4" aria-busy={loading}>
            <label htmlFor="guide-name" className="block text-sm font-semibold">Name *<input id="guide-name" name="name" autoComplete="name" maxLength={100} required className={inputClass} /></label>
            <label htmlFor="guide-email" className="block text-sm font-semibold">Email *<input id="guide-email" name="email" type="email" autoComplete="email" maxLength={254} required className={inputClass} /></label>
            <label htmlFor="guide-company" className="block text-sm font-semibold">Business or project name *<input id="guide-company" name="company" autoComplete="organization" maxLength={200} required className={inputClass} /></label>
            <label htmlFor="guide-region" className="block text-sm font-semibold">City, state / region, and country *<input id="guide-region" name="region" placeholder="Los Gatos, California, USA" maxLength={160} required className={inputClass} /></label>
            <label htmlFor="guide-role" className="block text-sm font-semibold">Your role (optional)<input id="guide-role" name="role" autoComplete="organization-title" maxLength={80} className={inputClass} /></label>
            <div hidden aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
            <p id="guide-privacy" className="text-xs leading-relaxed text-[#506458]">Profullstack, Inc. uses these details to record your request, deliver the guide, and respond to any call request. Marketing is optional. Do not enter tax IDs, bank details, or other sensitive business information. <a href="/privacy" className="underline">Privacy policy</a>.</p>
            <label className="flex gap-3 text-sm"><input name="privacyAccepted" type="checkbox" required aria-describedby="guide-privacy" className="mt-1 h-4 w-4 shrink-0" /><span>I acknowledge the privacy notice and request the guide. *</span></label>
            <label className="flex gap-3 text-sm"><input name="consultationInterest" type="checkbox" className="mt-1 h-4 w-4 shrink-0" /><span>Please contact me about an optional call for my region.</span></label>
            <label className="flex gap-3 text-sm"><input name="marketingConsent" type="checkbox" className="mt-1 h-4 w-4 shrink-0" /><span>I would like occasional CoinPayPortal updates and offers. Optional; not required for the PDF.</span></label>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            <button disabled={loading} type="submit" className="w-full rounded-lg bg-[#203b2f] px-5 py-3 font-semibold text-white transition hover:bg-[#2d5040] disabled:cursor-wait disabled:opacity-60">{loading ? 'Preparing your guide...' : 'Get the free PDF'}</button>
            <p className="text-center text-xs text-[#506458]">Complimentary PDF / Edition 1.3 / 69 pages</p>
          </form>
        </>
      )}
    </div>
  );
}
