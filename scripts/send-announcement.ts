#!/usr/bin/env npx tsx
/**
 * Send announcement email to all CoinPayPortal merchants
 * Usage: npx tsx scripts/send-announcement.ts [--dry-run]
 */

import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const isDryRun = process.argv.includes('--dry-run');

// Recipients are read from the database at run time, never hardcoded here.
//
// This file used to carry a literal array of real merchant names and email
// addresses, plus a second list of addresses to skip. That is production PII
// committed to a public-ish repository: readable by anyone with repo access,
// copied into every clone, and — because it was committed — permanent in git
// history regardless of what this file says now. Rotating it out of the working
// tree is necessary but NOT sufficient; see the note at the bottom.
//
// The comment above the old array even said "All merchants from DB", which is
// where they should have come from in the first place.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface Recipient {
  email: string;
  name: string;
}

/**
 * Disposable / obviously-fake signup domains. Kept as DOMAIN patterns rather
 * than as a list of specific people's addresses.
 */
const SKIP_DOMAINS = [
  'dnsclick.com',
  'emalupe.com',
  'mailinator.com',
  'tempmail.com',
  'guerrillamail.com',
];

function isSkippable(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return SKIP_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

async function loadRecipients(): Promise<Recipient[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set — ' +
        'recipients are read from the database, not from this file.'
    );
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase
    .from('merchants')
    .select('email, name')
    .not('email', 'is', null);

  if (error) {
    throw new Error(`Failed to load merchants: ${error.message}`);
  }

  return (data ?? [])
    .filter((m: { email: string | null }) => m.email && !isSkippable(m.email))
    .map((m: { email: string; name: string | null }) => ({
      email: m.email,
      name: m.name?.trim() || 'there',
    }));
}

const html = (name: string) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CoinPayPortal — Web Wallets & Escrow Now Live</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:40px 40px 30px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">⚡ CoinPayPortal</h1>
          <p style="margin:8px 0 0;color:#e9d5ff;font-size:16px;">Non-Custodial Crypto Payments</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:40px;">
          <p style="margin:0 0 20px;color:#374151;font-size:16px;line-height:1.6;">
            Hey ${name},
          </p>
          <p style="margin:0 0 20px;color:#374151;font-size:16px;line-height:1.6;">
            We've shipped some major features and wanted to make sure you know about them:
          </p>

          <!-- Web Wallets -->
          <div style="background:#faf5ff;border-left:4px solid #7c3aed;padding:20px;border-radius:0 8px 8px 0;margin:0 0 24px;">
            <h2 style="margin:0 0 8px;color:#6d28d9;font-size:20px;">🪪 Web Wallets — No Account Required</h2>
            <p style="margin:0;color:#4b5563;font-size:15px;line-height:1.6;">
              Anyone can receive crypto payments with a simple, shareable wallet page — no signup needed. 
              Just generate a wallet and share the link. Perfect for freelancers, one-off payments, or embedding in any workflow.
            </p>
          </div>

          <!-- Escrow -->
          <div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:20px;border-radius:0 8px 8px 0;margin:0 0 24px;">
            <h2 style="margin:0 0 8px;color:#16a34a;font-size:20px;">🔒 Escrow Services — For Humans & Agents</h2>
            <p style="margin:0;color:#4b5563;font-size:15px;line-height:1.6;">
              Trustless escrow for any transaction. Funds are held on-chain until both parties confirm — 
              with automatic refunds on expiry. Works for human-to-human, agent-to-agent, or any combination. 
              Built for the AI economy.
            </p>
          </div>

          <!-- Integrations -->
          <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:20px;border-radius:0 8px 8px 0;margin:0 0 24px;">
            <h2 style="margin:0 0 8px;color:#2563eb;font-size:20px;">🔌 Integrate via Web, CLI & SDK</h2>
            <p style="margin:0 0 12px;color:#4b5563;font-size:15px;line-height:1.6;">
              Whether you're building a web app, running a backend, or wiring up an AI agent:
            </p>
            <ul style="margin:0;padding:0 0 0 20px;color:#4b5563;font-size:15px;line-height:1.8;">
              <li><strong>Dashboard</strong> — Manage wallets, payments & escrow at <a href="https://coinpayportal.com" style="color:#7c3aed;">coinpayportal.com</a></li>
              <li><strong>REST API</strong> — Full API docs at <a href="https://coinpayportal.com/docs" style="color:#7c3aed;">coinpayportal.com/docs</a></li>
              <li><strong>CLI / SDK</strong> — <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:13px;">npm i coinpay-sdk</code> — programmatic access for bots, agents, and backends</li>
            </ul>
          </div>

          <!-- Supported Chains -->
          <div style="background:#fefce8;border-left:4px solid #ca8a04;padding:20px;border-radius:0 8px 8px 0;margin:0 0 30px;">
            <h2 style="margin:0 0 8px;color:#ca8a04;font-size:20px;">⛓️ Supported Chains</h2>
            <p style="margin:0;color:#4b5563;font-size:15px;line-height:1.6;">
              Bitcoin, Ethereum, Solana, Litecoin, Bitcoin Cash, Dogecoin, Monero, Nano — with more coming.
              All non-custodial. Your keys, your crypto.
            </p>
          </div>

          <!-- CTA -->
          <div style="text-align:center;margin:0 0 30px;">
            <a href="https://coinpayportal.com/dashboard" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:600;">
              Go to Dashboard →
            </a>
          </div>

          <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.6;text-align:center;">
            Questions? Just reply to this email — we read everything.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="margin:0;color:#9ca3af;font-size:13px;">
            CoinPayPortal by <a href="https://profullstack.com" style="color:#7c3aed;text-decoration:none;">Profullstack Inc</a>
            <br>Non-custodial crypto payments for the modern web
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

async function sendEmail(to: string, name: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'CoinPayPortal <noreply@coinpayportal.com>',
      to: [to],
      subject: '⚡ New: Web Wallets (No Account Needed) & Escrow — For Humans & AI Agents',
      html: html(name),
      reply_to: 'anthony@profullstack.com',
    }),
  });

  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const merchants = await loadRecipients();
  console.log(`${isDryRun ? '[DRY RUN] ' : ''}Sending announcement to ${merchants.length} merchants...\n`);

  let sent = 0;
  let errors = 0;

  for (const m of merchants) {
    if (isSkippable(m.email)) {
      console.log(`  SKIP: ${m.email} (disposable domain)`);
      continue;
    }

    if (isDryRun) {
      console.log(`  WOULD SEND: ${m.email} (${m.name})`);
      sent++;
      continue;
    }

    try {
      const result = await sendEmail(m.email, m.name);
      if (result.ok) {
        console.log(`  ✓ ${m.email}`);
        sent++;
      } else {
        console.log(`  ✗ ${m.email}: ${JSON.stringify(result.data)}`);
        errors++;
      }
      // Rate limit: 600ms between sends (Resend limit is 2/sec)
      await new Promise(r => setTimeout(r, 600));
    } catch (err) {
      console.log(`  ✗ ${m.email}: ${err}`);
      errors++;
    }
  }

  console.log(`\nDone: ${sent} sent, ${errors} errors`);
}

main();

// ---------------------------------------------------------------------------
// NOTE — removing the list from this file does not remove it from history.
//
// The addresses that used to live here remain in every prior commit and in
// every existing clone. Treat them as disclosed: they cannot be un-published by
// editing the working tree. Rewriting history on a shared branch is its own
// hazard and is deliberately not attempted here.
// ---------------------------------------------------------------------------
