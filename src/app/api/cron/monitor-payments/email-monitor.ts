/**
 * Email Monitor
 *
 * Sends escrow-related email notifications:
 * 1. Expiration reminders (24h, 12h, 2h) to depositor
 * 2. Settlement notifications to beneficiary
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';

export interface EmailStats {
  reminders_sent: number;
  settlements_sent: number;
  errors: number;
}

const FROM_EMAIL = process.env.FROM_EMAIL || 'CoinPayPortal <no-reply@coinpayportal.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';

const REMINDER_THRESHOLDS = [
  { hours: 24, field: 'reminder_24h_sent', label: '24 hours' },
  { hours: 12, field: 'reminder_12h_sent', label: '12 hours' },
  { hours: 2, field: 'reminder_2h_sent', label: '2 hours' },
] as const;

export async function monitorEmails(
  supabase: SupabaseClient,
  now: Date
): Promise<EmailStats> {
  const stats: EmailStats = { reminders_sent: 0, settlements_sent: 0, errors: 0 };

  try {
    await sendExpirationReminders(supabase, now, stats);
  } catch (err) {
    console.error('Expiration reminder error:', err);
    stats.errors++;
  }

  try {
    await sendSettlementNotifications(supabase, stats);
  } catch (err) {
    console.error('Settlement notification error:', err);
    stats.errors++;
  }

  return stats;
}

async function sendExpirationReminders(
  supabase: SupabaseClient,
  now: Date,
  stats: EmailStats
): Promise<void> {
  const { data: escrows, error } = await supabase
    .from('escrows')
    .select('id, depositor_email, escrow_address, amount, chain, expires_at, reminder_24h_sent, reminder_12h_sent, reminder_2h_sent')
    .eq('status', 'pending')
    .not('depositor_email', 'is', null)
    .limit(100);

  if (error || !escrows) return;

  for (const escrow of escrows) {
    const expiresAt = new Date(escrow.expires_at);
    const hoursLeft = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursLeft <= 0) continue; // already expired, skip

    for (const threshold of REMINDER_THRESHOLDS) {
      if (hoursLeft <= threshold.hours && !escrow[threshold.field]) {
        try {
          await sendEmail({
            to: escrow.depositor_email,
            from: FROM_EMAIL,
            subject: `⏰ Your escrow expires in ${threshold.label} — ${escrow.amount} ${escrow.chain}`,
            html: buildReminderHtml(escrow, threshold.label, expiresAt),
          });

          await supabase
            .from('escrows')
            .update({ [threshold.field]: true })
            .eq('id', escrow.id);

          stats.reminders_sent++;
          console.log(`Sent ${threshold.label} reminder for escrow ${escrow.id}`);
        } catch (err) {
          console.error(`Failed to send ${threshold.label} reminder for escrow ${escrow.id}:`, err);
          stats.errors++;
        }
      }
    }
  }
}

async function sendSettlementNotifications(
  supabase: SupabaseClient,
  stats: EmailStats
): Promise<void> {
  const { data: escrows, error } = await supabase
    .from('escrows')
    .select('id, beneficiary_email, amount, chain, settlement_tx_hash')
    .eq('status', 'settled')
    .eq('settled_email_sent', false)
    .not('beneficiary_email', 'is', null)
    .limit(100);

  if (error || !escrows) return;

  for (const escrow of escrows) {
    try {
      await sendEmail({
        to: escrow.beneficiary_email,
        from: FROM_EMAIL,
        subject: `🎉 You've been paid! ${escrow.amount} ${escrow.chain}`,
        html: buildSettlementHtml(escrow),
      });

      await supabase
        .from('escrows')
        .update({ settled_email_sent: true })
        .eq('id', escrow.id);

      stats.settlements_sent++;
      console.log(`Sent settlement notification for escrow ${escrow.id}`);
    } catch (err) {
      console.error(`Failed to send settlement email for escrow ${escrow.id}:`, err);
      stats.errors++;
    }
  }
}

function buildReminderHtml(
  escrow: { id: string; escrow_address: string; amount: number; chain: string; expires_at: string },
  timeframe: string,
  expiresAt: Date
): string {
  const manageUrl = `${APP_URL}/escrow/${escrow.id}`;
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1a1a1a;">⏰ Your Escrow Expires in ${timeframe}</h2>
      <p style="color: #4a4a4a; line-height: 1.6;">
        Your escrow is expiring soon. If you haven't deposited yet, please do so before it expires.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr><td style="padding: 8px 0; color: #666;">Escrow ID</td><td style="padding: 8px 0; font-family: monospace;">${escrow.id}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Amount</td><td style="padding: 8px 0; font-weight: bold;">${escrow.amount} ${escrow.chain}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Deposit Address</td><td style="padding: 8px 0; font-family: monospace; word-break: break-all;">${escrow.escrow_address}</td></tr>
        <tr><td style="padding: 8px 0; color: #666;">Expires At</td><td style="padding: 8px 0;">${expiresAt.toUTCString()}</td></tr>
      </table>
      <a href="${manageUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
        View Escrow
      </a>
      <p style="color: #999; font-size: 12px; margin-top: 30px;">
        This is an automated message from CoinPayPortal. Do not reply to this email.
      </p>
    </div>
  `;
}

function buildSettlementHtml(
  escrow: { id: string; amount: number; chain: string; settlement_tx_hash: string | null }
): string {
  const manageUrl = `${APP_URL}/escrow/${escrow.id}`;
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1a1a1a;">🎉 You've Been Paid!</h2>
      <p style="color: #4a4a4a; line-height: 1.6;">
        Great news! An escrow payment has been settled and the funds have been sent to your wallet.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr><td style="padding: 8px 0; color: #666;">Amount</td><td style="padding: 8px 0; font-weight: bold;">${escrow.amount} ${escrow.chain}</td></tr>
        ${escrow.settlement_tx_hash ? `<tr><td style="padding: 8px 0; color: #666;">Transaction</td><td style="padding: 8px 0; font-family: monospace; word-break: break-all;">${escrow.settlement_tx_hash}</td></tr>` : ''}
      </table>
      <a href="${manageUrl}" style="display: inline-block; background: #16a34a; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
        View Details
      </a>
      <p style="color: #999; font-size: 12px; margin-top: 30px;">
        This is an automated message from CoinPayPortal. Do not reply to this email.
      </p>
    </div>
  `;
}
