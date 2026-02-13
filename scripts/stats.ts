#!/usr/bin/env npx tsx
/**
 * coinpayportal.com Stats Dashboard
 * Usage: npx tsx scripts/stats.ts
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config(); // fallback to .env

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function count(table: string, filter?: Record<string, unknown>) {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (filter) {
    for (const [col, val] of Object.entries(filter)) {
      if (val === null) q = q.is(col, null);
      else if (typeof val === "string" && val.startsWith("not."))
        q = q.not(col, "is", null);
      else q = q.eq(col, val);
    }
  }
  const { count: c, error } = await q;
  if (error) {
    console.error(`  Error counting ${table}:`, error.message);
    return 0;
  }
  return c ?? 0;
}

async function countSince(table: string, col: string, days: number) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { count: c } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .gte(col, since);
  return c ?? 0;
}

async function sumColumn(table: string, col: string, filter?: Record<string, unknown>) {
  let q = supabase.from(table).select(col);
  if (filter) {
    for (const [k, v] of Object.entries(filter)) {
      q = q.eq(k, v as string);
    }
  }
  const { data, error } = await q;
  if (error || !data) return 0;
  return (data as unknown as Record<string, unknown>[]).reduce((sum: number, row: Record<string, unknown>) => {
    const val = Number(row[col]);
    return sum + (isNaN(val) ? 0 : val);
  }, 0);
}

function header(title: string) {
  console.log(`\n${"═".repeat(50)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(50));
}

function line(label: string, value: number | string) {
  console.log(`  ${label.padEnd(35)} ${value}`);
}

async function main() {
  console.log("📊 coinpayportal.com Stats Dashboard");
  console.log(`   ${new Date().toISOString()}\n`);

  // ── Merchants ──
  header("👤 Merchants");
  const totalMerchants = await count("merchants");
  const newMerchants7d = await countSince("merchants", "created_at", 7);
  const newMerchants30d = await countSince("merchants", "created_at", 30);

  line("Total merchants", totalMerchants);
  line("  New (7 days)", newMerchants7d);
  line("  New (30 days)", newMerchants30d);

  // ── Businesses ──
  header("🏢 Businesses");
  const totalBusinesses = await count("businesses");
  const newBiz7d = await countSince("businesses", "created_at", 7);

  line("Total businesses", totalBusinesses);
  line("  New (7 days)", newBiz7d);

  // ── Payments ──
  header("💰 Payments");
  const totalPayments = await count("payments");
  const confirmedPayments = await count("payments", { status: "confirmed" });
  const pendingPayments = await count("payments", { status: "pending" });
  const expiredPayments = await count("payments", { status: "expired" });
  const newPayments7d = await countSince("payments", "created_at", 7);
  const newPayments30d = await countSince("payments", "created_at", 30);

  line("Total payments", totalPayments);
  line("  Confirmed", confirmedPayments);
  line("  Pending", pendingPayments);
  line("  Expired", expiredPayments);
  line("  New (7 days)", newPayments7d);
  line("  New (30 days)", newPayments30d);

  // ── Payment Volume ──
  header("📈 Payment Volume (USD)");
  const totalVolume = await sumColumn("payments", "amount_usd", { status: "confirmed" });
  line("Total confirmed volume", `$${totalVolume.toFixed(2)}`);

  // ── Payment Addresses ──
  header("🔑 Payment Addresses");
  const totalAddrs = await count("payment_addresses");
  const usedAddrs = await count("payment_addresses", { is_used: true });

  line("Total addresses", totalAddrs);
  line("  Used", usedAddrs);
  line("  Available", totalAddrs - usedAddrs);

  // ── Escrows ──
  header("🔒 Escrows");
  const totalEscrows = await count("escrows");
  const fundedEscrows = await count("escrows", { status: "funded" });
  const releasedEscrows = await count("escrows", { status: "released" });
  const refundedEscrows = await count("escrows", { status: "refunded" });
  const disputedEscrows = await count("escrows", { status: "disputed" });
  const newEscrows7d = await countSince("escrows", "created_at", 7);

  line("Total escrows", totalEscrows);
  line("  Funded", fundedEscrows);
  line("  Released", releasedEscrows);
  line("  Refunded", refundedEscrows);
  line("  Disputed", disputedEscrows);
  line("  New (7 days)", newEscrows7d);

  // ── Wallets ──
  header("👛 Web Wallets");
  const totalWallets = await count("wallets");
  const totalWalletAddrs = await count("wallet_addresses");
  const totalWalletTxs = await count("wallet_transactions");
  const newWallets7d = await countSince("wallets", "created_at", 7);

  line("Total wallets", totalWallets);
  line("  Addresses", totalWalletAddrs);
  line("  Transactions", totalWalletTxs);
  line("  New (7 days)", newWallets7d);

  // ── Subscriptions ──
  header("📦 Subscriptions");
  const totalUsage = await count("monthly_usage");
  const totalHistory = await count("subscription_history");

  line("Monthly usage records", totalUsage);
  line("Subscription events", totalHistory);

  // ── Webhooks ──
  header("🔔 Webhooks");
  const totalWebhookLogs = await count("webhook_logs");
  const recentWebhooks7d = await countSince("webhook_logs", "created_at", 7);

  line("Total webhook deliveries", totalWebhookLogs);
  line("  Last 7 days", recentWebhooks7d);

  console.log(`\n${"═".repeat(50)}\n`);
}

main().catch(console.error);
