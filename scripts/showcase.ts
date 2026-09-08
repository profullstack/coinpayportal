/**
 * Frames for the hqtui.com apps showcase.
 *
 * hqtui.com/apps captures screenshots of applications built on the library. The
 * capture script takes an application directory and imports this file, because
 * only the application knows what a good state looks like.
 *
 * Every figure below is invented. This is a merchant's money: a screenshot from
 * a real session would publish somebody's revenue, bank balances and card
 * liabilities. The numbers are plausible rather than real, and no client, token
 * or account is involved in producing this frame.
 */
// @ts-expect-error — the SDK is plain JavaScript with no type declarations.
import { FINANCE_SCREENS } from "../packages/sdk/src/finances-tui.js";

const DAY = 86_400_000;
const START = Date.parse("2026-08-10T00:00:00.000Z");

/** Thirty days of volume, shaped like a business rather than a sine wave. */
const SERIES = Array.from({ length: 30 }, (_, i) => {
  const weekday = new Date(START + i * DAY).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  const base = weekend ? 900 : 3200 + (i % 5) * 420;
  const volumeUsd = Math.round(base * (1 + Math.sin(i / 3) * 0.22));
  return {
    label: new Date(START + i * DAY).toISOString().slice(0, 10),
    volumeUsd,
    commissionUsd: Math.round(volumeUsd * 0.019),
  };
});

const SNAPSHOT = {
  generatedAt: "2026-09-08T15:00:00.000Z",
  windowDays: 30,
  plan: { commission_percent: "1.9%" },
  earnings: {
    grossVolumeUsd: 74_820.44,
    cryptoVolumeUsd: 51_204.10,
    cardVolumeUsd: 23_616.34,
    commissionUsd: 1_421.59,
    stripeFeesUsd: 703.88,
    refundsUsd: 412.00,
    netUsd: 72_282.97,
    transactions: 486,
    failed: 7,
    failureRate: 1.4,
  },
  bank: {
    currency: "USD",
    accountCount: 4,
    assets: 128_940.12,
    liabilities: 14_206.55,
    net: 114_733.57,
    cashflow: { moneyIn: 71_204.00, moneyOut: 38_990.41, net: 32_213.59 },
    creditCards: [{ display_balance: -8_412.20 }, { display_balance: -5_794.35 }],
    connections: [{ last_synced_at: "2026-09-08T09:12:00.000Z", last_sync_status: "ok" }],
    ledger: [],
    ledgerTotal: 0,
    ledgerComplete: true,
  },
  invoices: {
    totals: { outstanding: 18_400.00, overdue: 2_150.00, paid: 44_920.00 },
    counts: { outstanding: 11, overdue: 2, paid: 38 },
  },
  escrow: {
    heldUsd: 9_600.00, held: 4,
    releasedUsd: 21_450.00, released: 12,
    refundedUsd: 0, refunded: 0,
  },
  payout: { pendingUsd: 6_310.00, paidUsd: 48_900.00 },
  crypto: {
    byChain: {
      ethereum: 21_400.55, solana: 12_980.10, base: 7_640.00,
      polygon: 4_820.45, bitcoin: 3_100.00, tron: 1_263.00,
    },
  },
  series: SERIES,
  errors: {},
};

const LIVE = [
  { time: "15:12:04", level: "PAY", message: "0.42 ETH received — invoice #1841", meta: "ethereum" },
  { time: "15:11:38", level: "CARD", message: "Charge captured $249.00", meta: "visa ·4242" },
  { time: "15:10:52", level: "SYNC", message: "Bank sync complete — 4 accounts", meta: "simplefin" },
  { time: "15:09:17", level: "PAY", message: "128.00 USDC received — invoice #1840", meta: "base" },
  { time: "15:08:02", level: "INFO", message: "Payout scheduled $6,310.00", meta: "ach" },
  { time: "15:06:44", level: "CARD", message: "Refund issued $42.00", meta: "visa ·1881" },
];

const STATE = {
  snapshot: SNAPSHOT,
  tab: 0,
  days: 30,
  paused: false,
  loading: false,
  error: null,
  lastRefresh: Date.parse("2026-09-08T15:00:00.000Z"),
  live: LIVE,
  liveStatus: "connected",
  panes: {},
};

export const frames = [
  {
    name: "coinpay",
    width: 138,
    height: 38,
    draw: ({ ui, theme }: { ui: unknown; theme: unknown }) => {
      const screens = FINANCE_SCREENS as Array<(ui: unknown, state: unknown, theme: unknown) => void>;
      // Tab 0 is Overview: earnings, bank position, pipeline, the volume graph
      // and the live payment feed on one screen.
      screens[0]?.(ui, STATE, theme);
    },
  },
];
