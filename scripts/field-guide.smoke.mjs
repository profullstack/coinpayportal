import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLead, escapeHtml, guideEmail, readBoundedJson, MAX_BODY_BYTES, GUIDE_PATH } from '../src/lib/field-guide/lead.mjs';
const valid = () => ({ name: 'Ada', email: 'Ada@Example.com', company: 'Example Inc.', region: 'Los Gatos, CA, USA', privacyAccepted: true });
test('normalizes email and defaults optional consents to false', () => {
  const result = validateLead(valid());
  assert.equal(result.email, 'ada@example.com');
  assert.equal(result.marketingConsent, false);
  assert.equal(result.consultationInterest, false);
});
test('requires meaningful business information', () => {
  for (const key of ['name', 'email', 'company', 'region']) assert.throws(() => validateLead({ ...valid(), [key]: '  ' }));
});
test('does not coerce consent strings', () => {
  assert.throws(() => validateLead({ ...valid(), marketingConsent: 'true' }));
  assert.throws(() => validateLead({ ...valid(), privacyAccepted: false }));
});
test('enforces length and email limits', () => {
  assert.throws(() => validateLead({ ...valid(), company: 'a'.repeat(201) }));
  assert.throws(() => validateLead({ ...valid(), email: 'not an email' }));
  assert.throws(() => validateLead({ ...valid(), name: 'A\nB' }));
});
test('requires object input', () => {
  for (const value of [null, false, [], 42]) assert.throws(() => validateLead(value));
});
test('captures explicit consultation interest separately', () => {
  const result = validateLead({ ...valid(), consultationInterest: true });
  assert.equal(result.consultationInterest, true); assert.equal(result.marketingConsent, false);
});
test('allows only bounded UTM fields and known sources', () => {
  const result = validateLead({ ...valid(), source: 'untrusted', utm: { secret: 'no', utm_source: 'x'.repeat(500) } });
  assert.equal(result.source, 'get-guide'); assert.equal(result.utm.utm_source.length, 120); assert.equal(result.utm.secret, undefined);
});
test('escapes HTML and keeps links publisher-controlled', () => {
  const result = guideEmail('<img src=x onerror=alert(1)>');
  assert.ok(!result.html.includes('<img')); assert.ok(result.html.includes('&lt;img'));
  assert.ok(result.html.includes(`https://coinpayportal.com${GUIDE_PATH}`));
  assert.equal(escapeHtml('"a&b\''), '&quot;a&amp;b&#39;');
});
test('accepts bounded JSON', async () => {
  const req = new Request('https://coinpayportal.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valid()) });
  assert.equal((await readBoundedJson(req)).name, 'Ada');
});
test('rejects oversized payload without trusting Content-Length', async () => {
  const req = new Request('https://coinpayportal.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: 'a'.repeat(MAX_BODY_BYTES) }) });
  await assert.rejects(readBoundedJson(req), /too large/);
});
test('rejects form posts and malformed JSON', async () => {
  await assert.rejects(readBoundedJson(new Request('https://coinpayportal.com', { method: 'POST', body: 'x=y' })), /JSON required/);
  await assert.rejects(readBoundedJson(new Request('https://coinpayportal.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })));
});
