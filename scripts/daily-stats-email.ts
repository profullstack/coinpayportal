#!/usr/bin/env npx tsx
/**
 * Daily Stats Email for CoinPayPortal
 *
 * Gathers platform stats and emails a daily report.
 * Run via cron: 0 8 * * * cd /home/ubuntu/src/coinpayportal && npx tsx scripts/daily-stats-email.ts
 *
 * Usage:
 *   npx tsx scripts/daily-stats-email.ts                    # send to default (hello@coinpayportal.com)
 *   npx tsx scripts/daily-stats-email.ts --to me@example.com
 *   npx tsx scripts/daily-stats-email.ts --dry-run          # print to stdout, don't send
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.prod") });
dotenv.config();

const DEFAULT_TO = "hello@coinpayportal.com";
const DRY_RUN = process.argv.includes("--dry-run");
const toArg = process.argv.findIndex((a) => a === "--to");
const TO_EMAIL = toArg >= 0 && process.argv[toArg + 1] ? process.argv[toArg + 1] : DEFAULT_TO;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Helpers ───────────────────────────────────────────────────────────────

async function count(table: string, filter?: Record<string, unknown>) {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (filter) {
    for (const [col, val] of Object.entries(filter)) {
      if (val === null) q = q.is(col, null);
      else q = q.eq(col, val as string);
    }
  }
  const { count: c } = await q;
  return c ?? 0;
}

async function countSince(table: string, col: string, hours: number) {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { count: c } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .gte(col, since);
  return c ?? 0;
}

async function countSinceDays(table: string, col: string, days: number) {
  return countSince(table, col, days * 24);
}

async function sumColumn(table: string, col: string, filter?: Record<string, unknown>) {
  let q = supabase.from(table).select(col);
  if (filter) {
    for (const [k, v] of Object.entries(filter)) {
      q = q.eq(k, v as string);
    }
  }
  const { data } = await q;
  if (!data) return 0;
  return (data as unknown as Record<string, unknown>[]).reduce((sum, row) => {
    const val = Number(row[col]);
    return sum + (isNaN(val) ? 0 : val);
  }, 0);
}

async function recentMerchants(limit: number) {
  const { data } = await supabase
    .from("merchants")
    .select("name, email, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data || [];
}

// ─── Spam detection stats ──────────────────────────────────────────────────

import { checkSpamSignup } from "../src/lib/auth/spam-detection";

async function spamStats() {
  const { data: merchants } = await supabase
    .from("merchants")
    .select("id, name, email, created_at");

  if (!merchants) return { total: 0, suspicious: 0, wouldBlock: 0 };

  let suspicious = 0;
  let wouldBlock = 0;

  for (const m of merchants) {
    const result = checkSpamSignup({ name: m.name || "", email: m.email });
    if (result.blocked) wouldBlock++;
    else if (result.score > 0) suspicious++;
  }

  return { total: merchants.length, suspicious, wouldBlock };
}

// ─── Build report ──────────────────────────────────────────────────────────

async function buildReport(): Promise<{ subject: string; html: string; text: string }> {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];

  // Merchants
  const totalMerchants = await count("merchants");
  const newMerchants24h = await countSince("merchants", "created_at", 24);
  const newMerchants7d = await countSinceDays("merchants", "created_at", 7);
  const newMerchants30d = await countSinceDays("merchants", "created_at", 30);
  const recent = await recentMerchants(5);

  // Wallets
  const totalWallets = await count("wallets");
  const totalWalletAddrs = await count("wallet_addresses");
  const totalWalletTxs = await count("wallet_transactions");
  const newWallets24h = await countSince("wallets", "created_at", 24);
  const newTxs24h = await countSince("wallet_transactions", "created_at", 24);

  // Payments
  const totalPayments = await count("payments");
  const confirmedPayments = await count("payments", { status: "confirmed" });
  const pendingPayments = await count("payments", { status: "pending" });
  const newPayments24h = await countSince("payments", "created_at", 24);

  // Volume
  const totalVolume = await sumColumn("payments", "amount_usd", { status: "confirmed" });

  // Escrows
  const totalEscrows = await count("escrows");
  const fundedEscrows = await count("escrows", { status: "funded" });
  const newEscrows24h = await countSince("escrows", "created_at", 24);

  // Businesses
  const totalBusinesses = await count("businesses");

  // Reputation
  const totalReceipts = await count("reputation_receipts");
  const newReceipts24h = await countSince("reputation_receipts", "created_at", 24);

  // Spam
  const spam = await spamStats();

  // ── Text version ──
  const text = `
CoinPayPortal Daily Report — ${dateStr}
${"=".repeat(50)}

MERCHANTS
  Total: ${totalMerchants}
  New (24h): ${newMerchants24h}
  New (7d): ${newMerchants7d}
  New (30d): ${newMerchants30d}

RECENT SIGNUPS
${recent.map((m) => `  • ${m.name || "(no name)"} — ${m.email} (${m.created_at?.slice(0, 10)})`).join("\n")}

WALLETS
  Total: ${totalWallets}
  Addresses: ${totalWalletAddrs}
  Transactions: ${totalWalletTxs}
  New wallets (24h): ${newWallets24h}
  New txs (24h): ${newTxs24h}

PAYMENTS
  Total: ${totalPayments}
  Confirmed: ${confirmedPayments}
  Pending: ${pendingPayments}
  New (24h): ${newPayments24h}
  Volume (confirmed): $${totalVolume.toFixed(2)}

ESCROWS
  Total: ${totalEscrows}
  Funded: ${fundedEscrows}
  New (24h): ${newEscrows24h}

BUSINESSES: ${totalBusinesses}

REPUTATION
  Receipts: ${totalReceipts}
  New (24h): ${newReceipts24h}

SPAM DETECTION
  Current merchants: ${spam.total}
  Suspicious (score > 0): ${spam.suspicious}
  Would be blocked today: ${spam.wouldBlock}
`.trim();

  // ── HTML version ──
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a2e; background: #f8f9fa;">
  <div style="background: #1a1a2e; color: white; padding: 20px 24px; border-radius: 12px 12px 0 0;">
    <h1 style="margin: 0; font-size: 20px;">📊 CoinPayPortal Daily Report</h1>
    <p style="margin: 4px 0 0; opacity: 0.7; font-size: 14px;">${dateStr}</p>
  </div>

  <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0; border-top: none;">

    <h2 style="font-size: 16px; color: #7c3aed; margin: 0 0 12px;">👤 Merchants</h2>
    <table style="width: 100%; font-size: 14px; margin-bottom: 20px;">
      <tr><td style="padding: 4px 0;">Total</td><td style="text-align: right; font-weight: bold;">${totalMerchants}</td></tr>
      <tr><td style="padding: 4px 0;">New (24h)</td><td style="text-align: right; font-weight: bold; color: ${newMerchants24h > 0 ? "#16a34a" : "#666"};">${newMerchants24h}</td></tr>
      <tr><td style="padding: 4px 0;">New (7d)</td><td style="text-align: right;">${newMerchants7d}</td></tr>
      <tr><td style="padding: 4px 0;">New (30d)</td><td style="text-align: right;">${newMerchants30d}</td></tr>
    </table>

    ${recent.length > 0 ? `
    <h3 style="font-size: 14px; color: #666; margin: 0 0 8px;">Recent Signups</h3>
    <ul style="font-size: 13px; padding-left: 20px; margin: 0 0 20px;">
      ${recent.map((m) => `<li style="margin-bottom: 4px;"><strong>${m.name || "(no name)"}</strong> — ${m.email} <span style="color: #999;">(${m.created_at?.slice(0, 10)})</span></li>`).join("")}
    </ul>
    ` : ""}

    <h2 style="font-size: 16px; color: #7c3aed; margin: 0 0 12px;">👛 Wallets & Transactions</h2>
    <table style="width: 100%; font-size: 14px; margin-bottom: 20px;">
      <tr><td style="padding: 4px 0;">Wallets</td><td style="text-align: right; font-weight: bold;">${totalWallets}</td></tr>
      <tr><td style="padding: 4px 0;">Addresses</td><td style="text-align: right;">${totalWalletAddrs}</td></tr>
      <tr><td style="padding: 4px 0;">Transactions</td><td style="text-align: right; font-weight: bold;">${totalWalletTxs}</td></tr>
      <tr><td style="padding: 4px 0;">New wallets (24h)</td><td style="text-align: right; color: ${newWallets24h > 0 ? "#16a34a" : "#666"};">${newWallets24h}</td></tr>
      <tr><td style="padding: 4px 0;">New txs (24h)</td><td style="text-align: right; color: ${newTxs24h > 0 ? "#16a34a" : "#666"};">${newTxs24h}</td></tr>
    </table>

    <h2 style="font-size: 16px; color: #7c3aed; margin: 0 0 12px;">💰 Payments</h2>
    <table style="width: 100%; font-size: 14px; margin-bottom: 20px;">
      <tr><td style="padding: 4px 0;">Total</td><td style="text-align: right; font-weight: bold;">${totalPayments}</td></tr>
      <tr><td style="padding: 4px 0;">Confirmed</td><td style="text-align: right;">${confirmedPayments}</td></tr>
      <tr><td style="padding: 4px 0;">Pending</td><td style="text-align: right;">${pendingPayments}</td></tr>
      <tr><td style="padding: 4px 0;">New (24h)</td><td style="text-align: right; color: ${newPayments24h > 0 ? "#16a34a" : "#666"};">${newPayments24h}</td></tr>
      <tr><td style="padding: 4px 0;">Volume (confirmed)</td><td style="text-align: right; font-weight: bold; color: #16a34a;">$${totalVolume.toFixed(2)}</td></tr>
    </table>

    <h2 style="font-size: 16px; color: #7c3aed; margin: 0 0 12px;">🔒 Escrows</h2>
    <table style="width: 100%; font-size: 14px; margin-bottom: 20px;">
      <tr><td style="padding: 4px 0;">Total</td><td style="text-align: right;">${totalEscrows}</td></tr>
      <tr><td style="padding: 4px 0;">Funded</td><td style="text-align: right;">${fundedEscrows}</td></tr>
      <tr><td style="padding: 4px 0;">New (24h)</td><td style="text-align: right;">${newEscrows24h}</td></tr>
    </table>

    <h2 style="font-size: 16px; color: #7c3aed; margin: 0 0 12px;">🛡️ Spam Detection</h2>
    <table style="width: 100%; font-size: 14px; margin-bottom: 20px;">
      <tr><td style="padding: 4px 0;">Current merchants</td><td style="text-align: right;">${spam.total}</td></tr>
      <tr><td style="padding: 4px 0;">Suspicious (not blocked)</td><td style="text-align: right; color: ${spam.suspicious > 0 ? "#d97706" : "#666"};">${spam.suspicious}</td></tr>
      <tr><td style="padding: 4px 0;">Would be blocked today</td><td style="text-align: right; color: ${spam.wouldBlock > 0 ? "#dc2626" : "#666"};">${spam.wouldBlock}</td></tr>
    </table>

    <div style="font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 12px; margin-top: 12px;">
      Businesses: ${totalBusinesses} · Reputation receipts: ${totalReceipts} (${newReceipts24h} new)
    </div>
  </div>

  <p style="text-align: center; font-size: 12px; color: #999; margin-top: 16px;">
    Sent by CoinPayPortal Stats · <a href="https://coinpayportal.com" style="color: #7c3aed;">coinpayportal.com</a>
  </p>
</body>
</html>
`.trim();

  return {
    subject: `📊 CoinPayPortal Daily — ${dateStr} | ${totalMerchants} merchants, ${totalWalletTxs} txs, $${totalVolume.toFixed(0)} vol`,
    html,
    text,
  };
}

// ─── Send email ────────────────────────────────────────────────────────────

async function sendViaMailgun(to: string, subject: string, html: string) {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;

  if (!apiKey || !domain) {
    throw new Error("MAILGUN_API_KEY or MAILGUN_DOMAIN not configured");
  }

  const form = new URLSearchParams();
  form.append("from", `CoinPayPortal Stats <stats@${domain}>`);
  form.append("to", to);
  form.append("subject", subject);
  form.append("html", html);

  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mailgun error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`📊 Building daily stats report...`);

  const report = await buildReport();

  if (DRY_RUN) {
    console.log(`\nSubject: ${report.subject}\nTo: ${TO_EMAIL}\n`);
    console.log(report.text);
    console.log("\n(dry run — email not sent)");
    return;
  }

  console.log(`📧 Sending to ${TO_EMAIL}...`);
  const result = await sendViaMailgun(TO_EMAIL, report.subject, report.html);
  console.log(`✅ Sent! Message ID: ${result.id}`);
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
