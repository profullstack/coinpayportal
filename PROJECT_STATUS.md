# CoinPayPortal — Project Status

> **This is the single source of truth for project status.**
> Updated: 2026-04-07
> Fork of: [profullstack/coinpayportal](https://github.com/profullstack/coinpayportal)
> Deployed at: **https://coinpay.eww-pew.com** (Coolify, Docker Compose build pack)

---

## 🗂 Document Map

| File | Purpose | Status |
|------|---------|--------|
| `PROJECT_STATUS.md` (this file) | Single source of truth — overall status | ✅ Current |
| `TODO.md` | Active sprint checklist — web wallet launch | ✅ Current |
| `SECURITY_AUDIT.md` | Security audit findings (Feb 2026) | ✅ Current — findings unresolved |
| `.drewrox2009/FORK_TRACKING.md` | Fork-specific ops: Docker, Coolify, env vars | ✅ Current |
| `README.md` | Public-facing project overview and quick start | ✅ Current |
| `docs/` | Architecture, API, database, security reference docs | ✅ Reference |
| `archive/PROGRESS.md` | ❌ Frozen Nov 2025 — merchant gateway only | Archived |
| `archive/IMPLEMENTATION_STATUS.md` | ❌ Frozen Nov 2025 — broken phase numbering | Archived |
| `archive/IMPLEMENTATION_PLAN.md` | ❌ Pre-build planning doc, wrong fee (2% not 0.5%) | Archived |

---

## 🚀 Deployment

| Item | Detail |
|------|--------|
| **Production URL** | https://coinpay.eww-pew.com |
| **Host** | Coolify (self-hosted) |
| **Build** | Docker Compose — `docker/docker-compose.yml` |
| **Port** | App listens on **8080** |
| **Builder** | Docker Compose build pack (`context: ..`, `dockerfile: docker/Dockerfile`) |
| **Railway** | `railway.json` forces Railpack, ignores Dockerfile |

See [`.drewrox2009/FORK_TRACKING.md`](.drewrox2009/FORK_TRACKING.md) for full deployment history and gotchas.

---

## ✅ What's Complete

### Merchant Payment Gateway (Complete — shipped ~Nov 2025)
- [x] Authentication system (JWT + API keys, bcrypt, PBKDF2)
- [x] Exchange rates via Tatum API (BTC, ETH, SOL, POL, USDC, 5-min cache)
- [x] QR code generation (BIP21/EIP681, PNG + SVG)
- [x] Fee calculations (platform: **0.5%**, merchant receives: **99.5%**)
- [x] Business management (CRUD, API key regen, webhook secrets, wallet config)
- [x] Payment creation, status tracking, history
- [x] Webhook system (HMAC-SHA256, exponential backoff, logging)
- [x] Payment forwarding (99.5% merchant / 0.5% platform split, batch, retry)
- [x] Email notifications (Resend primary, Mailgun fallback)
- [x] Business Collection Payments (`POST/GET /api/business-collection`)
- [x] Analytics event tracking
- [x] Landing page with live payment demo, pricing, SDK preview
- [x] Wallet connections via Reown AppKit (MetaMask, WalletConnect, Phantom, Solflare, Coinbase)
- [x] Real-time payment status (`usePaymentStatus` hook, countdown, confirmations)
- [x] **409+ tests passing** (>80% coverage)

### Stripe Integration (Complete — shipped ~Nov–Dec 2025)
- [x] Stripe connected accounts
- [x] Business name on Stripe statement descriptor
- [x] `platform_fee_amount` column in `stripe_transactions`
- [x] Crypto Transactions / Escrows / Payouts tabs in dashboard
- [x] Merchant info, Stripe fee, connected account email in transactions view

### Web Wallet (Complete — shipped ~Jan–Feb 2026)
- [x] BIP39 mnemonic generation (12/24 words, `@scure/bip39`)
- [x] BIP32/BIP44 HD key derivation for BTC, BCH, ETH, POL, SOL
- [x] Auth-Lite: challenge/response, per-request signature, JWT convenience
- [x] Replay attack prevention (timestamp + nonce)
- [x] Full wallet API (`create`, `import`, `derive`, `balances`, `transactions`, `broadcast`)
- [x] Balance indexer for all chains + USDC variants (with TTL caching)
- [x] Transaction history with pagination + filtering
- [x] Unsigned TX preparation + fee estimation (all chains)
- [x] Client-side signing library (ETH EIP-1559, BTC P2PKH, BCH, SOL)
- [x] TX broadcast + retry + confirmation tracking
- [x] Bot SDK (`@coinpayportal/wallet-sdk`) — create, import, send, events, CLI
- [x] Full Web Wallet UI (`/web-wallet`) — create, import, dashboard, send, receive, history, settings
- [x] Seed phrase display/verification, AES-256-GCM localStorage encryption
- [x] Auto-lock on inactivity, memory clearing after signing
- [x] Spend limit checks, address whitelist checks (backend)
- [x] Multi-wallet UI with wallet selector (Feb 2026)
- [x] GPG seed backup with wallet label

### Infrastructure & DevOps (Complete — shipped ~Feb–Apr 2026)
- [x] Docker multi-stage build (Node 20 Alpine)
- [x] Coolify Docker Compose deployment (working — see FORK_TRACKING.md)
- [x] Railway Railpack config (ignores Dockerfile)
- [x] `.env.example` fully audited with all `process.env` references
- [x] Mnemonic generation script (`scripts/gen-mnemonic.mjs`)
- [x] `SECURITY_AUDIT.md` — full security audit performed

### Security Audit (Performed Feb 2026 — findings in `SECURITY_AUDIT.md`)
- [x] Non-custodial architecture confirmed ✅ (server never receives private keys)
- [x] Key management: LOW risk
- [x] Authentication: LOW risk
- [x] Transaction signing: LOW risk
- [x] XSS: LOW risk (React auto-escaping, no dangerouslySetInnerHTML)
- [x] CSRF: LOW risk (Authorization headers, not cookies)

---

## ❌ What's NOT Done (Open Work)

### 🔴 High Priority — Security (from `SECURITY_AUDIT.md`)
- [ ] **CSP headers** — no Content-Security-Policy configured (`next.config.mjs`) — **HIGH**
- [ ] **Security response headers** — X-Frame-Options, X-Content-Type-Options, Referrer-Policy — **HIGH**
- [ ] **HSTS header** — Strict-Transport-Security — **MEDIUM**
- [ ] **Redis rate limiting** — currently in-memory only (breaks under multi-server) — **MEDIUM**
- [ ] **CORS configuration** for API routes — **LOW**

### 🟡 Medium Priority — Testing & Quality
- [ ] E2E tests (Playwright): UI wallet create, import, send, receive, settings
- [ ] Send transaction flow on testnet (integration test)
- [ ] Load/stress testing (indexer, API, concurrent wallet ops)
- [ ] Color contrast accessibility review (4.5:1 minimum)
- [ ] Test on various screen sizes (responsive design QA)

### 🟡 Medium Priority — SDK & Docs
- [ ] SDK README with quick start
- [ ] Document all SDK API methods
- [ ] Create SDK usage examples
- [ ] Publish `@coinpayportal/wallet-sdk` to npm

### 🟢 Lower Priority — Settings & UX
- [ ] Daily spend limit setting UI (backend exists)
- [ ] Address whitelist management UI (backend exists)

### 🟢 Lower Priority — Launch
- [ ] Deploy indexer service (separate process)
- [ ] Set up monitoring dashboards
- [ ] Set up alerting
- [ ] Internal testing complete sign-off
- [ ] Beta user testing
- [ ] Rollback plan documented
- [ ] Support channels ready
- [ ] Add `pnpm audit` to CI pipeline

---

## 🔑 Key Facts

| Item | Value |
|------|-------|
| Platform fee | **0.5%** (merchant receives 99.5%) |
| Test count | **409+ tests passing** |
| Supported chains | BTC, BCH, ETH, POL, SOL, USDC (ETH/POL/SOL) |
| Wallet encryption | AES-256-GCM, PBKDF2 600k iterations |
| Seed: server stores? | **No** — non-custodial, client-only |
| Auth | JWT (1hr) + per-request signature auth |
| Email | Resend (primary), Mailgun (fallback) |

---

## 📋 Active Checklist

For the detailed sprint checklist (web wallet phases 5–6), see **[`TODO.md`](TODO.md)**.

For security remediations to implement, see **[`SECURITY_AUDIT.md`](SECURITY_AUDIT.md)** → Section 10 (Recommendations Summary).

---

*Last updated: 2026-04-07 by drewrox2009*
