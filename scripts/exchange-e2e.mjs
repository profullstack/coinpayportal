// Prod end-to-end test of the CoinPay Exchange Engine (internal mode). No funds move.
//   node scripts/exchange-e2e.mjs create   creates wallets A and B; put A in EXCHANGE_INTERNAL_WALLETS
//   node scripts/exchange-e2e.mjs run      runs the checks (BASE=https://coinpayportal.com by default)
// Wallet keys are throwaway and kept in E2E_STATE (default ~/.cache), never in the repo.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';


const { secp256k1 } = await import('@noble/curves/secp256k1.js');
const BASE = process.env.BASE || 'https://coinpayportal.com';
// MODE=public (default) when the engine is open to everyone; MODE=internal when only wallet A is allowlisted.
const MODE = process.env.MODE || 'public';
const errMsg = (j) => j?.error?.message ?? j?.error;
// EXPECT_FEE_BPS: the free-tier CoinPay fee these throwaway wallets should be quoted (0 = fee off).
const FEE_BPS = Number(process.env.EXPECT_FEE_BPS ?? 200);
const STATE = process.env.E2E_STATE || `${process.env.HOME}/.cache/coinpay-exchange-e2e-wallets.json`;
const hex = (b) => Buffer.from(b).toString('hex');

function newKey() {
  const priv = secp256k1.utils.randomSecretKey();
  return { priv: hex(priv), pub: hex(secp256k1.getPublicKey(priv, true)) };
}
function sign(privHex, msg) {
  return hex(secp256k1.sign(new TextEncoder().encode(msg), Buffer.from(privHex, 'hex')));
}

async function createWallet() {
  const k = newKey();
  const message = `coinpay exchange e2e ${Date.now()}`;
  const res = await fetch(`${BASE}/api/web-wallet/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      public_key_secp256k1: k.pub,
      initial_addresses: [],
      proof_of_ownership: { message, signature: sign(k.priv, message) },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`create wallet ${res.status}: ${JSON.stringify(body)}`);
  const id = body.data?.wallet_id ?? body.data?.id ?? body.wallet_id ?? body.id;
  return { id, ...k };
}

async function call(w, method, path, bodyObj, extraHeaders = {}) {
  const body = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
  const headers = { ...extraHeaders };
  if (bodyObj !== undefined) headers['content-type'] = 'application/json';
  if (w) {
    const ts = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(8).toString('hex');
    const p = new URL(path, BASE).pathname;
    headers.authorization = `Wallet ${w.id}:${sign(w.priv, `${method}:${p}:${ts}:${nonce}:${body}`)}:${ts}:${nonce}`;
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: bodyObj === undefined ? undefined : body });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const mode = process.argv[2];
if (mode === 'create') {
  const A = await createWallet();
  const B = await createWallet();
  writeFileSync(STATE, JSON.stringify({ A, B }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ A: A.id, B: B.id }));
  process.exit(0);
}
if (!existsSync(STATE)) throw new Error('run create first');
const { A, B } = JSON.parse(readFileSync(STATE, 'utf8'));
const ETH_DEST = '0x00000000000000000000000000000000000000a1';
const BTC_DEST = 'bc1q0y356csjsefu3gtqe505he6p40a8dm7kd6ayht';

// 1. Who can see it depends on the mode.
let r;
if (MODE === 'internal') {
  r = await call(null, 'GET', '/api/exchange/assets');
  check('anonymous assets -> 503', r.status === 503, `${r.status} ${r.json?.error?.code}`);
  r = await call(null, 'POST', '/api/exchange/quotes', { from: 'BTC', to: 'ETH', amount: '0.01' });
  check('anonymous quote -> 503', r.status === 503, `${r.status}`);
  r = await call(B, 'POST', '/api/exchange/quotes', { from: 'BTC', to: 'ETH', amount: '0.01' });
  check('non-allowlisted wallet quote -> 503', r.status === 503, `${r.status}`);
  r = await call(B, 'GET', '/api/exchange/orders');
  check('non-allowlisted wallet orders -> 503', r.status === 503, `${r.status}`);
} else {
  r = await call(null, 'GET', '/api/exchange/assets');
  check('public: anonymous assets -> 200', r.status === 200 && r.json?.success === true, `${r.status}`);
  r = await call(null, 'GET', '/api/exchange/orders');
  check('public: anonymous orders -> 401', r.status === 401, `${r.status} ${r.json?.error?.code}`);
  r = await call(B, 'GET', '/api/exchange/orders');
  check('public: any wallet can list its own orders', r.status === 200 && Array.isArray(r.json?.data?.orders), `${r.status}`);
}

// 2. Allowlisted wallet: assets + quotes from both providers.
r = await call(A, 'GET', '/api/exchange/assets');
check('assets -> 200 (SDK envelope)', r.json?.success === true && Array.isArray(r.json?.data?.assets) && r.status === 200, `${r.json?.assets?.length} assets, fiat=${r.json?.rails?.fiat_crypto}`);
r = await call(A, 'POST', '/api/exchange/quotes', { from: 'BTC', to: 'ETH', amount: '0.01' });
const quotes = r.json?.quotes ?? [];
check('BTC->ETH quotes -> 200', r.status === 200, quotes.map((q) => `${q.provider} ${q.expectedAmountOut} ETH`).join(', ') + (r.json?.unavailable?.length ? ` | unavailable: ${JSON.stringify(r.json.unavailable)}` : ''));
check('both providers quoted (THORChain BTC halt tolerated)', r.json?.unavailable?.some((u) => /halted/.test(u.reason)) || quotes.some((q) => q.provider === 'thorchain') && quotes.some((q) => q.provider === 'changenow'));
check('ranked by delivered amount', quotes.length < 2 || Number(quotes[0].expectedAmountOut) >= Number(quotes[1].expectedAmountOut));
if (FEE_BPS > 0) {
  check(`quotes carry the ${FEE_BPS / 100}% CoinPay fee (0.01 BTC -> ${(0.01 * FEE_BPS) / 10000} BTC)`,
    quotes.length > 0 && quotes.every((q) => q.coinpayFee?.bps === FEE_BPS && Number(q.coinpayFee.amount) === (0.01 * FEE_BPS) / 10000 && q.coinpayFee.tier === 'free'),
    JSON.stringify(quotes[0]?.coinpayFee));
} else {
  check('no CoinPay fee on quotes', quotes.every((q) => !q.coinpayFee));
}
check('disclosure present, no "no KYC" claim', /may require verification/.test(r.json?.disclosure ?? '') && !/no.?kyc/i.test(JSON.stringify(r.json)));

r = await call(A, 'POST', '/api/exchange/quotes', { from: 'BTC', to: 'ETH', amount: '1e3' });
check('bad amount -> 400', r.status === 400, errMsg(r.json));
r = await call(A, 'POST', '/api/exchange/quotes', { from: 'BTC', to: 'SHIB', amount: '1' });
check('unsupported asset -> 400', r.status === 400, errMsg(r.json));
r = await call(A, 'POST', '/api/exchange/quotes', { from: 'BTC', to: 'ETH', amount: '0.01', destinationAddress: BTC_DEST });
check('wrong-chain destination -> 400', r.status === 400, errMsg(r.json));

// 3. THORChain order: plan, idempotent replay, status, cancel.
// BTC trading can be halted by THORChain governance; exercise THORChain on a live pair.
r = await call(A, 'POST', '/api/exchange/quotes', { from: 'DOGE', to: 'ETH', amount: '500' });
check('DOGE->ETH quotes -> 200', r.status === 200, (r.json?.quotes ?? []).map((q) => `${q.provider} ${q.expectedAmountOut} ETH`).join(', ') + (r.json?.unavailable?.length ? ` | unavailable: ${JSON.stringify(r.json.unavailable)}` : ''));
const tq = (r.json?.quotes ?? []).find((q) => q.provider === 'thorchain');
check('THORChain quoted DOGE->ETH', !!tq);
if (tq) {
  const key = `e2e-${randomUUID()}`;
  r = await call(A, 'POST', '/api/exchange/orders', { quoteId: tq.id, destinationAddress: BTC_DEST }, { 'idempotency-key': key });
  check('THORChain order, wrong-chain destination -> 400', r.status === 400, errMsg(r.json));
  r = await call(A, 'POST', '/api/exchange/orders', { quoteId: tq.id, destinationAddress: ETH_DEST }, { 'idempotency-key': key });
  const o = r.json?.order;
  check('THORChain order -> 201', r.status === 201, `${o?.status} ${o?.nextAction?.kind} to=${o?.nextAction?.to} memo=${o?.nextAction?.memo}`);
  check('plan is send_with_memo to our destination', o?.nextAction?.kind === 'send_with_memo' && o?.nextAction?.memo?.includes(ETH_DEST));
  if (FEE_BPS > 0) {
    const fee = (500 * FEE_BPS) / 10000;
    check(`THORChain plan splits 500 DOGE into ${500 - fee} deposit + ${fee} fee`,
      Number(o?.nextAction?.amount) === 500 - fee && Number(o?.nextAction?.fee?.amount) === fee && !!o?.nextAction?.fee?.to && o?.fee?.paid === false,
      `deposit=${o?.nextAction?.amount} fee=${o?.nextAction?.fee?.amount} to=${o?.nextAction?.fee?.to}`);
  }
  r = await call(A, 'POST', '/api/exchange/orders', { quoteId: tq.id, destinationAddress: ETH_DEST }, { 'idempotency-key': key });
  check('same idempotency key -> same order, no second provider call', r.status === 200 && r.json?.replayed === true && r.json?.order?.id === o?.id);
  r = await call(A, 'GET', `/api/exchange/orders/${o?.id}`);
  check('GET order -> awaiting_user_action', r.json?.order?.status === 'awaiting_user_action', r.json?.order?.status);
  r = await call(B, 'GET', `/api/exchange/orders/${o?.id}`);
  check('other wallet cannot read it', r.status === 503 || r.status === 404, `${r.status}`);
  r = await call(A, 'POST', `/api/exchange/orders/${o?.id}/cancel`, {});
  check('cancel -> cancelled', r.json?.order?.status === 'cancelled', r.json?.order?.status ?? JSON.stringify(r.json));
  r = await call(A, 'POST', `/api/exchange/orders/${o?.id}/cancel`, {});
  check('cancel again -> 409', r.status === 409, errMsg(r.json));
  r = await call(A, 'POST', `/api/exchange/orders/${o?.id}/submit`, { txHash: 'ab'.repeat(32) });
  check('submit tx on cancelled order -> 409', r.status === 409, errMsg(r.json));
}

// 4. ChangeNOW order: real provider order (deposit address), never funded, then cancel.
const cq = quotes.find((q) => q.provider === 'changenow');
if (cq) {
  r = await call(A, 'POST', '/api/exchange/orders', { quoteId: cq.id, destinationAddress: ETH_DEST, refundAddress: BTC_DEST }, { 'idempotency-key': `e2e-${randomUUID()}` });
  const o = r.json?.order;
  check('ChangeNOW order -> 201 with deposit address', r.status === 201 && o?.nextAction?.kind === 'send' && !!o?.nextAction?.to, `${r.status} ${o?.providerOrderId} deposit=${o?.nextAction?.to} ${errMsg(r.json) ?? ''}`);
  if (o?.id && FEE_BPS > 0) {
    const fee = (0.01 * FEE_BPS) / 10000;
    check(`ChangeNOW plan splits 0.01 BTC into ${0.01 - fee} deposit + ${fee} fee`,
      Math.abs(Number(o.nextAction?.amount) - (0.01 - fee)) < 1e-12 && Number(o.nextAction?.fee?.amount) === fee && !!o.nextAction?.fee?.to,
      `deposit=${o.nextAction?.amount} fee=${o.nextAction?.fee?.amount} to=${o.nextAction?.fee?.to}`);
    r = await call(A, 'POST', `/api/exchange/orders/${o.id}/submit`, { feeTxHash: 'not-a-hash' });
    check('bad fee tx hash -> 400', r.status === 400, errMsg(r.json));
  }
  if (o?.id) {
    r = await call(A, 'GET', `/api/exchange/orders/${o.id}`);
    check('ChangeNOW status poll', r.status === 200, `${r.json?.order?.status} / provider ${r.json?.order?.providerStatus}`);
    r = await call(A, 'POST', `/api/exchange/orders/${o.id}/cancel`, {});
    check('ChangeNOW cancel -> cancelled', r.json?.order?.status === 'cancelled', r.json?.order?.status);
  }
}

// 5. History.
r = await call(A, 'GET', '/api/exchange/orders');
check('order history lists them', r.status === 200 && (r.json?.orders?.length ?? 0) >= 1, `${r.json?.orders?.length} orders`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
