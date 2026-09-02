/**
 * Minimal PayPal REST API v2 client.
 *
 * We talk to PayPal over plain HTTPS (no SDK) so there's no extra dependency to
 * ship. Every call takes its credentials explicitly rather than reading platform
 * env vars, because the same functions serve both connection modes:
 *
 *  - self-serve: the credentials ARE the merchant's, so PayPal treats the call
 *    as first-party and no `payee`/`platform_fees` may be sent.
 *  - partner: the credentials are the platform's, and `authAssertionMerchantId`
 *    plus `payeeMerchantId` tell PayPal which onboarded merchant the money is
 *    for. Only this mode can carry a platform fee.
 *
 * See ./platform.ts for how those modes are configured and ./accounts.ts for
 * how a business is resolved into one.
 */

export type PaypalEnvironment = 'sandbox' | 'live';

export interface PaypalCredentials {
  clientId: string;
  clientSecret: string;
  environment: PaypalEnvironment;
}

/**
 * Partner-mode addressing. Absent on self-serve calls.
 *
 * `authAssertionMerchantId` is the merchant's `merchant_id_in_paypal` (their
 * PayPal payer id), NOT our business uuid. Sending our own id produces a
 * confusing 401 from PayPal rather than a validation error.
 */
export interface PaypalCallContext {
  /** Merchant to act on behalf of, via the PayPal-Auth-Assertion header. */
  authAssertionMerchantId?: string | null;
  /** Partner attribution id (BN code), sent as PayPal-Partner-Attribution-Id. */
  bnCode?: string | null;
  /** Idempotency key, sent as PayPal-Request-Id. */
  requestId?: string | null;
}

export function paypalApiBase(environment: PaypalEnvironment): string {
  return environment === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
}

/**
 * Fetch an OAuth2 access token via client_credentials. Doubles as credential
 * validation — a bad client id/secret throws here.
 */
export async function getPaypalAccessToken(creds: PaypalCredentials): Promise<string> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const res = await fetch(`${paypalApiBase(creds.environment)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const detail = await safeErrorText(res);
    throw new Error(`PayPal auth failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('PayPal auth response missing access_token');
  }
  return data.access_token;
}

/**
 * Build a PayPal-Auth-Assertion header value.
 *
 * It is an unsigned JWT (`alg: none`) — PayPal authenticates the *caller* by the
 * bearer token and reads this only to select which onboarded merchant to act
 * as, so there is nothing to sign. Base64URL, and the trailing dot is required.
 */
export function paypalAuthAssertion(clientId: string, merchantIdInPaypal: string): string {
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64url({ alg: 'none' })}.${b64url({ iss: clientId, payer_id: merchantIdInPaypal })}.`;
}

function buildHeaders(
  token: string,
  creds: PaypalCredentials,
  context?: PaypalCallContext
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (context?.authAssertionMerchantId) {
    headers['PayPal-Auth-Assertion'] = paypalAuthAssertion(
      creds.clientId,
      context.authAssertionMerchantId
    );
  }
  if (context?.bnCode) {
    headers['PayPal-Partner-Attribution-Id'] = context.bnCode;
  }
  if (context?.requestId) {
    headers['PayPal-Request-Id'] = context.requestId;
  }
  return headers;
}

/**
 * One authenticated PayPal call: fetch a token, then issue the request. Kept
 * uncached deliberately — tokens are per-credential-set and short-lived, and a
 * shared cache in a serverless runtime buys little for the staleness risk.
 */
async function paypalRequest<T>(
  creds: PaypalCredentials,
  path: string,
  init: { method: string; body?: unknown; context?: PaypalCallContext; label: string }
): Promise<T> {
  const token = await getPaypalAccessToken(creds);
  const res = await fetch(`${paypalApiBase(creds.environment)}${path}`, {
    method: init.method,
    headers: buildHeaders(token, creds, init.context),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  if (!res.ok) {
    const detail = await safeErrorText(res);
    throw new Error(`${init.label} failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }

  // 204 No Content is a success with nothing to parse.
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export interface CreateOrderParams extends PaypalCredentials, PaypalCallContext {
  amount: string | number;
  currency: string;
  /** Short human reference shown on the PayPal review page, e.g. invoice number. */
  referenceId?: string;
  description?: string;
  returnUrl: string;
  cancelUrl: string;
  brandName?: string;
  /** Opaque id echoed back on webhooks — we put the transaction row id here. */
  customId?: string;
  /** Merchant-facing invoice number. PayPal enforces uniqueness per merchant. */
  invoiceId?: string;
  /** Prefills the payer's email on the PayPal review page. */
  payerEmail?: string | null;
  /**
   * Partner mode only: the onboarded merchant who receives the funds. Omit for
   * self-serve, where the credentials already identify the payee.
   */
  payeeMerchantId?: string | null;
  /**
   * Partner mode only: platform commission, as a decimal string or number in
   * the same currency. Requires payeeMerchantId and platformFeePayeeMerchantId.
   */
  platformFee?: string | number | null;
  /** Partner mode only: who collects the platform fee (the partner's own id). */
  platformFeePayeeMerchantId?: string | null;
}

export interface PaypalOrder {
  orderId: string;
  /** The URL the payer must be redirected to in order to approve the order. */
  approveUrl: string;
  status: string;
}

export async function createPaypalOrder(params: CreateOrderParams): Promise<PaypalOrder> {
  const currencyCode = params.currency.toUpperCase();
  const value = Number(params.amount).toFixed(2);

  const purchaseUnit: Record<string, unknown> = {
    reference_id: params.referenceId,
    description: params.description?.slice(0, 127),
    amount: {
      currency_code: currencyCode,
      value,
    },
  };
  if (params.customId) purchaseUnit.custom_id = params.customId.slice(0, 127);
  if (params.invoiceId) purchaseUnit.invoice_id = params.invoiceId.slice(0, 127);
  if (params.payeeMerchantId) purchaseUnit.payee = { merchant_id: params.payeeMerchantId };

  // A platform fee is only legal alongside an explicit payee — PayPal rejects
  // platform_fees on a first-party order. Requiring both here means a
  // misconfigured partner account fails loudly at build time of the request
  // rather than silently shipping a 0% take rate.
  const feeValue =
    params.platformFee === null || params.platformFee === undefined
      ? null
      : Number(params.platformFee);
  if (feeValue !== null && feeValue > 0) {
    if (!params.payeeMerchantId || !params.platformFeePayeeMerchantId) {
      throw new Error(
        'PayPal platform fee requires both payeeMerchantId and platformFeePayeeMerchantId'
      );
    }
    purchaseUnit.payment_instruction = {
      disbursement_mode: 'INSTANT',
      platform_fees: [
        {
          amount: { currency_code: currencyCode, value: feeValue.toFixed(2) },
          payee: { merchant_id: params.platformFeePayeeMerchantId },
        },
      ],
    };
  }

  const body: Record<string, unknown> = {
    intent: 'CAPTURE',
    purchase_units: [purchaseUnit],
    application_context: {
      brand_name: params.brandName || 'CoinPay',
      user_action: 'PAY_NOW',
      shipping_preference: 'NO_SHIPPING',
      return_url: params.returnUrl,
      cancel_url: params.cancelUrl,
    },
  };
  if (params.payerEmail) {
    body.payer = { email_address: params.payerEmail };
  }

  const data = await paypalRequest<{
    id: string;
    status: string;
    links?: { href: string; rel: string }[];
  }>(params, '/v2/checkout/orders', {
    method: 'POST',
    body,
    context: params,
    label: 'PayPal create order',
  });

  const approve = data.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  if (!approve?.href) {
    throw new Error('PayPal create order response missing approve link');
  }

  return { orderId: data.id, approveUrl: approve.href, status: data.status };
}

export interface CaptureParams extends PaypalCredentials, PaypalCallContext {
  orderId: string;
}

export interface PaypalCapture {
  status: string;
  captureId: string | null;
  payerEmail: string | null;
  amount: string | null;
  currency: string | null;
  /** PayPal's own processing fee, when the breakdown is present. */
  paypalFee: string | null;
  /** What actually lands in the merchant's balance, net of PayPal's fee. */
  netAmount: string | null;
  /** The platform fee PayPal actually took, when this was a partner order. */
  platformFee: string | null;
  /** The merchant PayPal credited. Useful for reconciling partner orders. */
  payeeMerchantId: string | null;
  /** Echoed back from custom_id — our transaction row id on partner orders. */
  customId: string | null;
}

function extractCapture(data: any): PaypalCapture {
  const unit = data?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const breakdown = capture?.seller_receivable_breakdown;
  const platformFee = breakdown?.platform_fees?.[0]?.amount?.value ?? null;

  return {
    status: data?.status || capture?.status || 'UNKNOWN',
    captureId: capture?.id ?? null,
    payerEmail: data?.payer?.email_address ?? null,
    amount: capture?.amount?.value ?? null,
    currency: capture?.amount?.currency_code ?? null,
    paypalFee: breakdown?.paypal_fee?.value ?? null,
    netAmount: breakdown?.net_amount?.value ?? null,
    platformFee,
    payeeMerchantId: unit?.payee?.merchant_id ?? null,
    customId: capture?.custom_id ?? unit?.custom_id ?? null,
  };
}

export async function capturePaypalOrder(params: CaptureParams): Promise<PaypalCapture> {
  const data = await paypalRequest<any>(
    params,
    `/v2/checkout/orders/${encodeURIComponent(params.orderId)}/capture`,
    { method: 'POST', context: params, label: 'PayPal capture' }
  );
  return extractCapture(data);
}

export interface GetOrderParams extends PaypalCredentials, PaypalCallContext {
  orderId: string;
}

/**
 * Read an order back from PayPal. Used to reconcile a return-URL hit against
 * what PayPal actually recorded, so a forged callback can't move a row.
 */
export async function getPaypalOrder(params: GetOrderParams): Promise<PaypalCapture> {
  const data = await paypalRequest<any>(
    params,
    `/v2/checkout/orders/${encodeURIComponent(params.orderId)}`,
    { method: 'GET', context: params, label: 'PayPal get order' }
  );
  return extractCapture(data);
}

export interface RefundParams extends PaypalCredentials, PaypalCallContext {
  captureId: string;
  /** Omit for a full refund. */
  amount?: string | number | null;
  currency?: string;
  noteToPayer?: string;
  invoiceId?: string;
}

export interface PaypalRefund {
  refundId: string;
  status: string;
  amount: string | null;
  currency: string | null;
}

export async function refundPaypalCapture(params: RefundParams): Promise<PaypalRefund> {
  const body: Record<string, unknown> = {};
  if (params.amount !== null && params.amount !== undefined) {
    body.amount = {
      value: Number(params.amount).toFixed(2),
      currency_code: (params.currency || 'USD').toUpperCase(),
    };
  }
  if (params.noteToPayer) body.note_to_payer = params.noteToPayer.slice(0, 255);
  if (params.invoiceId) body.invoice_id = params.invoiceId.slice(0, 127);

  const data = await paypalRequest<any>(
    params,
    `/v2/payments/captures/${encodeURIComponent(params.captureId)}/refund`,
    { method: 'POST', body, context: params, label: 'PayPal refund' }
  );

  return {
    refundId: data?.id ?? '',
    status: data?.status || 'UNKNOWN',
    amount: data?.amount?.value ?? null,
    currency: data?.amount?.currency_code ?? null,
  };
}

export interface VerifyWebhookParams extends PaypalCredentials {
  webhookId: string;
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
  /** The parsed event body. Must be the same JSON PayPal signed. */
  event: unknown;
}

/**
 * Verify an inbound PayPal webhook by asking PayPal.
 *
 * PayPal has no local HMAC scheme like Stripe's — verification is a round trip
 * against `/v1/notifications/verify-webhook-signature`. Treat any non-SUCCESS
 * result, and any error, as a failed verification: this returns false rather
 * than throwing so a caller cannot accidentally accept an event by catching.
 */
export async function verifyPaypalWebhookSignature(
  params: VerifyWebhookParams
): Promise<boolean> {
  try {
    const data = await paypalRequest<{ verification_status?: string }>(
      params,
      '/v1/notifications/verify-webhook-signature',
      {
        method: 'POST',
        body: {
          auth_algo: params.authAlgo,
          cert_url: params.certUrl,
          transmission_id: params.transmissionId,
          transmission_sig: params.transmissionSig,
          transmission_time: params.transmissionTime,
          webhook_id: params.webhookId,
          webhook_event: params.event,
        },
        label: 'PayPal webhook verification',
      }
    );
    return data?.verification_status === 'SUCCESS';
  } catch (error) {
    console.error('[PayPal] Webhook verification call failed:', error);
    return false;
  }
}

export interface BalanceParams extends PaypalCredentials, PaypalCallContext {
  currency?: string;
}

export interface PaypalBalance {
  currency: string;
  /** Funds available to spend or withdraw now. */
  available: string;
  /** Funds held by PayPal and not yet available. */
  withheld: string;
  total: string;
  primary: boolean;
}

/**
 * Read a merchant's PayPal balances. Requires the Reporting/Balances scope to
 * have been granted at onboarding; a merchant who declined it gets a 403 from
 * PayPal, which surfaces here as a thrown error the caller renders as "not
 * available" rather than as a page failure.
 */
export async function getPaypalBalances(params: BalanceParams): Promise<PaypalBalance[]> {
  const query = params.currency ? `?currency_code=${encodeURIComponent(params.currency.toUpperCase())}` : '';
  const data = await paypalRequest<any>(params, `/v1/reporting/balances${query}`, {
    method: 'GET',
    context: params,
    label: 'PayPal balances',
  });

  const balances = Array.isArray(data?.balances) ? data.balances : [];
  return balances.map((b: any) => ({
    currency: b?.currency ?? 'USD',
    available: b?.available_balance?.value ?? '0.00',
    withheld: b?.withheld_balance?.value ?? '0.00',
    total: b?.total_balance?.value ?? '0.00',
    primary: !!b?.primary,
  }));
}

async function safeErrorText(res: Response): Promise<string> {
  try {
    const body = await res.json();
    // PayPal puts the useful part in details[] for validation errors; the
    // top-level message is often just "The requested action could not be
    // performed", which tells an operator nothing.
    const detail = Array.isArray(body?.details) && body.details.length
      ? body.details.map((d: any) => d?.issue || d?.description).filter(Boolean).join('; ')
      : '';
    const base = body?.message || body?.error_description || body?.name || '';
    return [base, detail].filter(Boolean).join(' — ');
  } catch {
    return '';
  }
}
