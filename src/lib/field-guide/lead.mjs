export const GUIDE_SLUG = 'los-gatos-s-corp-1-3';
export const GUIDE_FILENAME = 'coinpayportal-los-gatos-field-guide-edition-1-3.pdf';
export const GUIDE_PATH = `/guides/${GUIDE_FILENAME}`;
export const SUPPORT_EMAIL = 'support@coinpayportal.com';
export const SUPPORT_PHONE = '(888) 526-4640';
export const CONTACT_URL = 'https://coinpayportal.com/contact';
export const NOTICE_VERSION = 'field-guide-2026-10-04-v1';
export const MAX_BODY_BYTES = 8192;

/** @param {unknown} value */
export function validateLead(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request.');
  const b = /** @type {Record<string, unknown>} */ (value);
  /** @param {string} key @param {number} max @param {boolean} [required] */
  const field = (key, max, required = true) => {
    const v = b[key] === undefined && !required ? '' : b[key];
    if (typeof v !== 'string' || v.length > max || /[\x00-\x1f\x7f]/.test(v) || (required && !v.trim())) {
      throw new Error(`Please check ${key}.`);
    }
    return v.trim();
  };
  const name = field('name', 100);
  const email = field('email', 254).toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error('Please enter a valid email.');
  const company = field('company', 200);
  const region = field('region', 160);
  const role = field('role', 80, false);
  const website = field('website', 200, false); // honeypot, not the company's URL
  for (const key of ['privacyAccepted', 'marketingConsent', 'consultationInterest']) {
    if (b[key] !== undefined && typeof b[key] !== 'boolean') throw new Error(`Please check ${key}.`);
  }
  if (b.privacyAccepted !== true) throw new Error('Please acknowledge the privacy notice.');
  const source = b.source === 'homepage' ? 'homepage' : 'get-guide';
  const utm = /** @type {Record<string, string>} */ ({});
  if (b.utm && typeof b.utm === 'object' && !Array.isArray(b.utm)) {
    const input = /** @type {Record<string, unknown>} */ (b.utm);
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      if (typeof input[k] === 'string') utm[k] = input[k].replace(/[\x00-\x1f\x7f]/g, '').slice(0, 120);
    }
  }
  return { name, email, company, region, role, website, source, utm,
    marketingConsent: b.marketingConsent === true,
    consultationInterest: b.consultationInterest === true };
}

/** @param {string} value */
export function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
}

/** @param {string} name */
export function guideEmail(name) {
  return {
    subject: 'Your free Online S-Corp Field Guide from CoinPayPortal',
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#203b2f;max-width:580px;margin:auto;padding:24px;background:#f5f3ed">
      <p style="font-weight:bold">CoinPayPortal / The founder's field guides</p>
      <h1 style="font-family:Georgia,serif">Your guide is ready.</h1>
      <p>Hi ${escapeHtml(name)},</p>
      <p>Here is the complimentary Los Gatos &amp; surrounding cities edition of The Online S-Corp Field Guide, from Profullstack, Inc., creators of CoinPayPortal.</p>
      <p><a href="https://coinpayportal.com${GUIDE_PATH}" style="display:inline-block;padding:12px 20px;background:#203b2f;color:#fff;text-decoration:none">Download the 69-page PDF</a></p>
      <p>Practical accounting tips for humans, technical tips for agents, and our CoinPay, Mercury and moomoo workflows.</p>
      <p>The guide provides general education, not individualized legal, tax or investment advice.</p>
      <p>Questions about the download? Reply to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> or call <a href="tel:+18885264640">${SUPPORT_PHONE}</a>.</p>
      <p style="font-size:12px">This is the one-time delivery email you requested, not a marketing subscription.</p>
    </div>`,
  };
}

/** @param {Request} request */
export async function readBoundedJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('JSON required.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Request body required.');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('Request too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
