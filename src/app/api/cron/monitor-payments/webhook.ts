/**
 * Webhook Notification Sender
 *
 * Sends webhook notifications for payment status changes.
 * Uses SDK-compliant payload format with HMAC signature.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Payment } from './types';

/**
 * Send webhook notification for payment status change
 * Uses SDK-compliant payload format: { id, type, data, created_at, business_id }
 * Signature format: t=timestamp,v1=signature (matching SDK expectations)
 */
export async function sendWebhook(
  supabase: SupabaseClient,
  payment: Payment,
  event: string,
  additionalData?: Record<string, unknown>
): Promise<void> {
  try {
    const { data: business } = await supabase
      .from('businesses')
      .select('webhook_url, webhook_secret')
      .eq('id', payment.business_id)
      .single();
    
    if (!business?.webhook_url) {
      console.log(`No webhook URL configured for business ${payment.business_id}`);
      return;
    }
    
    const now = new Date();
    const timestamp = Math.floor(now.getTime() / 1000);
    
    const payload = {
      id: `evt_${payment.id}_${timestamp}`,
      type: event,
      data: {
        payment_id: payment.id,
        status: payment.status,
        blockchain: payment.blockchain,
        amount_crypto: String(payment.crypto_amount),
        payment_address: payment.payment_address,
        ...additionalData,
      },
      created_at: now.toISOString(),
      business_id: payment.business_id,
    };
    
    const payloadString = JSON.stringify(payload);
    
    // Create HMAC signature in SDK format: t=timestamp,v1=signature
    let signature = '';
    if (business.webhook_secret) {
      const encoder = new TextEncoder();
      const signedPayload = `${timestamp}.${payloadString}`;
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(business.webhook_secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signatureBuffer = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(signedPayload)
      );
      const signatureHex = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      signature = `t=${timestamp},v1=${signatureHex}`;
    }
    
    const response = await fetch(business.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CoinPay-Signature': signature,
        'User-Agent': 'CoinPay-Webhook/1.0',
      },
      body: payloadString,
    });
    
    // Log webhook delivery
    await supabase.from('webhook_logs').insert({
      business_id: payment.business_id,
      payment_id: payment.id,
      event,
      webhook_url: business.webhook_url,
      success: response.ok,
      status_code: response.status,
      error_message: response.ok ? null : `HTTP ${response.status}`,
      attempt_number: 1,
      response_time_ms: 0,
      created_at: now.toISOString(),
    });
    
    console.log(`Webhook sent for payment ${payment.id}: ${event} -> ${response.status}`);
  } catch (error) {
    console.error(`Failed to send webhook for payment ${payment.id}:`, error);
  }
}
