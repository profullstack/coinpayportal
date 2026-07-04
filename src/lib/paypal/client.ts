/**
 * Minimal PayPal REST API v2 client.
 *
 * We talk to PayPal over plain HTTPS (no SDK) so there's no extra dependency to
 * ship. Each merchant supplies their own REST app credentials, so every call
 * takes the credentials explicitly rather than reading platform env vars.
 */

export type PaypalEnvironment = 'sandbox' | 'live';

export interface PaypalCredentials {
  clientId: string;
  clientSecret: string;
  environment: PaypalEnvironment;
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

export interface CreateOrderParams extends PaypalCredentials {
  amount: string | number;
  currency: string;
  /** Short human reference shown on the PayPal review page, e.g. invoice number. */
  referenceId?: string;
  description?: string;
  returnUrl: string;
  cancelUrl: string;
  brandName?: string;
}

export interface PaypalOrder {
  orderId: string;
  /** The URL the payer must be redirected to in order to approve the order. */
  approveUrl: string;
  status: string;
}

export async function createPaypalOrder(params: CreateOrderParams): Promise<PaypalOrder> {
  const token = await getPaypalAccessToken(params);
  const value = Number(params.amount).toFixed(2);

  const res = await fetch(`${paypalApiBase(params.environment)}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: params.referenceId,
          description: params.description?.slice(0, 127),
          amount: {
            currency_code: params.currency.toUpperCase(),
            value,
          },
        },
      ],
      application_context: {
        brand_name: params.brandName || 'CoinPay',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
      },
    }),
  });

  if (!res.ok) {
    const detail = await safeErrorText(res);
    throw new Error(`PayPal create order failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }

  const data = (await res.json()) as {
    id: string;
    status: string;
    links?: { href: string; rel: string }[];
  };
  const approve = data.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  if (!approve?.href) {
    throw new Error('PayPal create order response missing approve link');
  }

  return { orderId: data.id, approveUrl: approve.href, status: data.status };
}

export interface CaptureParams extends PaypalCredentials {
  orderId: string;
}

export interface PaypalCapture {
  status: string;
  captureId: string | null;
  payerEmail: string | null;
  amount: string | null;
  currency: string | null;
}

export async function capturePaypalOrder(params: CaptureParams): Promise<PaypalCapture> {
  const token = await getPaypalAccessToken(params);

  const res = await fetch(
    `${paypalApiBase(params.environment)}/v2/checkout/orders/${encodeURIComponent(params.orderId)}/capture`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!res.ok) {
    const detail = await safeErrorText(res);
    throw new Error(`PayPal capture failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }

  const data = (await res.json()) as any;
  const capture = data?.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    status: data?.status || capture?.status || 'UNKNOWN',
    captureId: capture?.id ?? null,
    payerEmail: data?.payer?.email_address ?? null,
    amount: capture?.amount?.value ?? null,
    currency: capture?.amount?.currency_code ?? null,
  };
}

async function safeErrorText(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.message || body?.error_description || body?.name || '';
  } catch {
    return '';
  }
}
