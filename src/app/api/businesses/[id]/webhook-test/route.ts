import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifySession } from '@/lib/auth/service';
import { deliverWebhook, signWebhookPayload } from '@/lib/webhooks/service';

/**
 * POST /api/businesses/[id]/webhook-test
 * Send a test webhook to the configured webhook URL
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing or invalid authorization header',
        },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);

    // Create Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error',
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify session
    const sessionResult = await verifySession(supabase, token);
    if (!sessionResult.success || !sessionResult.merchant) {
      return NextResponse.json(
        {
          success: false,
          error: sessionResult.error || 'Authentication failed',
        },
        { status: 401 }
      );
    }

    const { id: businessId } = await params;

    // Verify the business belongs to the merchant
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id, name, webhook_url, webhook_secret')
      .eq('id', businessId)
      .eq('merchant_id', sessionResult.merchant.id)
      .single();

    if (businessError || !business) {
      return NextResponse.json(
        {
          success: false,
          error: 'Business not found or access denied',
        },
        { status: 404 }
      );
    }

    // Check if webhook URL is configured
    if (!business.webhook_url) {
      return NextResponse.json(
        {
          success: false,
          error: 'No webhook URL configured. Please set a webhook URL first.',
        },
        { status: 400 }
      );
    }

    // Check if webhook secret is configured
    if (!business.webhook_secret) {
      return NextResponse.json(
        {
          success: false,
          error: 'No webhook secret configured. Please generate a webhook secret first.',
        },
        { status: 400 }
      );
    }

    // Create test payload
    const testPayload = {
      event: 'test.webhook' as const,
      payment_id: `test_${Date.now()}`,
      business_id: businessId,
      amount_crypto: '0.001',
      amount_usd: '50.00',
      currency: 'BTC',
      status: 'test',
      confirmations: 6,
      tx_hash: `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`,
      message: 'This is a test webhook from CoinPay',
    };

    // Sign the payload
    const payloadWithTimestamp = {
      ...testPayload,
      timestamp: new Date().toISOString(),
    };
    const signature = signWebhookPayload(payloadWithTimestamp, business.webhook_secret);

    // Deliver the webhook
    const startTime = Date.now();
    let responseBody: string | null = null;
    let responseHeaders: Record<string, string> = {};

    try {
      const response = await fetch(business.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'User-Agent': 'CoinPay-Webhook/1.0',
        },
        body: JSON.stringify(payloadWithTimestamp),
        signal: AbortSignal.timeout(30000),
      });

      const responseTime = Date.now() - startTime;

      // Try to get response body
      try {
        responseBody = await response.text();
      } catch {
        responseBody = null;
      }

      // Get response headers
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      // Log the test attempt
      await supabase.from('webhook_logs').insert({
        business_id: businessId,
        payment_id: testPayload.payment_id,
        event: 'test.webhook',
        webhook_url: business.webhook_url,
        success: response.ok,
        status_code: response.status,
        error_message: response.ok ? null : `HTTP ${response.status}: ${response.statusText}`,
        attempt_number: 1,
        response_time_ms: responseTime,
        created_at: new Date().toISOString(),
      });

      return NextResponse.json(
        {
          success: true,
          test_result: {
            delivered: response.ok,
            status_code: response.status,
            status_text: response.statusText,
            response_time_ms: responseTime,
            response_body: responseBody,
            response_headers: responseHeaders,
            request: {
              url: business.webhook_url,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Signature': signature.substring(0, 20) + '...',
                'User-Agent': 'CoinPay-Webhook/1.0',
              },
              body: payloadWithTimestamp,
            },
          },
        },
        { status: 200 }
      );
    } catch (fetchError) {
      const responseTime = Date.now() - startTime;
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      // Log the failed test attempt
      await supabase.from('webhook_logs').insert({
        business_id: businessId,
        payment_id: testPayload.payment_id,
        event: 'test.webhook',
        webhook_url: business.webhook_url,
        success: false,
        status_code: null,
        error_message: errorMessage,
        attempt_number: 1,
        response_time_ms: responseTime,
        created_at: new Date().toISOString(),
      });

      return NextResponse.json(
        {
          success: true,
          test_result: {
            delivered: false,
            status_code: null,
            status_text: null,
            response_time_ms: responseTime,
            error: errorMessage,
            request: {
              url: business.webhook_url,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Signature': signature.substring(0, 20) + '...',
                'User-Agent': 'CoinPay-Webhook/1.0',
              },
              body: payloadWithTimestamp,
            },
          },
        },
        { status: 200 }
      );
    }
  } catch (error) {
    console.error('Webhook test error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}