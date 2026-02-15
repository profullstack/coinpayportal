/**
 * LNbits API Client
 * 
 * Connects to our CLN + LNbits infrastructure at ln.coinpayportal.com
 * for multi-user Lightning wallets, invoices, and Lightning Addresses.
 */

const LNBITS_URL = process.env.LNBITS_URL || 'https://ln.coinpayportal.com';
const LNBITS_ADMIN_KEY = process.env.LNBITS_ADMIN_KEY || '';
const LNBITS_INVOICE_KEY = process.env.LNBITS_INVOICE_KEY || '';

interface LNbitsWallet {
  id: string;
  name: string;
  adminkey: string;
  inkey: string;
  balance: number;
}

interface LNbitsInvoice {
  payment_hash: string;
  payment_request: string;
  checking_id: string;
  lnurl_response: string | null;
}

interface LNbitsPayLink {
  id: number;
  wallet: string;
  description: string;
  min: number;
  max: number;
  served_meta: number;
  served_pr: number;
  username: string | null;
  domain: string | null;
  lnurl: string;
}

interface LNbitsPayment {
  payment_hash: string;
  pending: boolean;
  amount: number;
  fee: number;
  memo: string;
  time: number;
  bolt11: string;
  preimage: string;
  extra: Record<string, unknown>;
}

async function lnbitsRequest(
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    apiKey?: string;
  } = {}
) {
  const { method = 'GET', body, apiKey = LNBITS_ADMIN_KEY } = options;
  
  const headers: Record<string, string> = {
    'X-Api-Key': apiKey,
    'Content-Type': 'application/json',
  };

  const res = await fetch(`${LNBITS_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LNbits API error ${res.status}: ${text}`);
  }

  return res.json();
}

// ── Wallet Management ──

/** Create a new LNbits wallet for a user */
export async function createUserWallet(username: string): Promise<LNbitsWallet> {
  // Create wallet under the admin user
  const wallet = await lnbitsRequest('/api/v1/wallet', {
    method: 'POST',
    body: { name: username },
  });
  return wallet;
}

/** Get wallet details */
export async function getWallet(apiKey: string): Promise<{ name: string; balance: number; id: string }> {
  return lnbitsRequest('/api/v1/wallet', { apiKey });
}

/** Get wallet balance in sats */
export async function getBalance(apiKey: string): Promise<number> {
  const wallet = await getWallet(apiKey);
  return Math.floor(wallet.balance / 1000); // msat to sat
}

// ── Invoices ──

/** Create a BOLT11 invoice */
export async function createInvoice(
  apiKey: string,
  amount: number, // sats
  memo: string = ''
): Promise<LNbitsInvoice> {
  return lnbitsRequest('/api/v1/payments', {
    method: 'POST',
    apiKey,
    body: {
      out: false,
      amount,
      memo,
    },
  });
}

/** Pay a BOLT11 invoice */
export async function payInvoice(
  apiKey: string,
  bolt11: string
): Promise<LNbitsPayment> {
  return lnbitsRequest('/api/v1/payments', {
    method: 'POST',
    apiKey,
    body: {
      out: true,
      bolt11,
    },
  });
}

/** Check payment status */
export async function checkPayment(
  apiKey: string,
  paymentHash: string
): Promise<{ paid: boolean }> {
  return lnbitsRequest(`/api/v1/payments/${paymentHash}`, { apiKey });
}

/** List payments */
export async function listPayments(
  apiKey: string,
  limit: number = 20
): Promise<LNbitsPayment[]> {
  return lnbitsRequest(`/api/v1/payments?limit=${limit}`, { apiKey });
}

// ── Pay Links (LNURLp / Lightning Address) ──

/** Create a pay link (enables Lightning Address) */
export async function createPayLink(
  apiKey: string,
  opts: {
    description: string;
    min: number; // sats
    max: number; // sats
    username?: string;
  }
): Promise<LNbitsPayLink> {
  return lnbitsRequest('/lnurlp/api/v1/links', {
    method: 'POST',
    apiKey,
    body: {
      description: opts.description,
      min: opts.min,
      max: opts.max,
      comment_chars: 255,
      username: opts.username || undefined,
    },
  });
}

/** Get a pay link by ID */
export async function getPayLink(
  apiKey: string,
  linkId: number
): Promise<LNbitsPayLink> {
  return lnbitsRequest(`/lnurlp/api/v1/links/${linkId}`, { apiKey });
}

/** List all pay links */
export async function listPayLinks(apiKey: string): Promise<LNbitsPayLink[]> {
  return lnbitsRequest('/lnurlp/api/v1/links', { apiKey });
}

/** Delete a pay link */
export async function deletePayLink(apiKey: string, linkId: number): Promise<void> {
  await lnbitsRequest(`/lnurlp/api/v1/links/${linkId}`, {
    method: 'DELETE',
    apiKey,
  });
}

// ── Lightning Address ──

/**
 * Proxy handler for /.well-known/lnurlp/<username>
 * Forward the request to LNbits which serves the LNURL-pay response
 */
export async function getLnurlPayResponse(username: string): Promise<Response> {
  const res = await fetch(`${LNBITS_URL}/.well-known/lnurlp/${username}`);
  return res;
}

/**
 * Proxy handler for LNURL-pay callback
 */
export async function getLnurlPayCallback(
  username: string, 
  params: URLSearchParams
): Promise<Response> {
  const res = await fetch(
    `${LNBITS_URL}/.well-known/lnurlp/${username}?${params.toString()}`
  );
  return res;
}

export default {
  createUserWallet,
  getWallet,
  getBalance,
  createInvoice,
  payInvoice,
  checkPayment,
  listPayments,
  createPayLink,
  getPayLink,
  listPayLinks,
  deletePayLink,
  getLnurlPayResponse,
  getLnurlPayCallback,
};
