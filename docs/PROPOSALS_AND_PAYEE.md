# Proposals, payee resolution, and connected web wallets

Three related changes:

1. **Every invoice and proposal must name a payee.** No exceptions, and manual
   entry when nothing can be derived from the account.
2. **Web wallets can be associated with an account**, becoming a payee source.
3. **Proposals** — quotes that either party can accept, reject, or re-negotiate.

---

## 1. The payee rule

`src/lib/payments/payee.ts` is the single place that answers "where does this
money land?".

```
resolvePayee(supabase, { businessId, merchantId, cryptocurrency, requestedAddress })
```

Resolution order:

| # | Source | Table |
|---|--------|-------|
| 1 | Address supplied by the caller (manual entry) | — |
| 2 | The business's own wallet for that coin | `business_wallets` |
| 3 | The account-global wallet for that coin | `merchant_wallets` |
| 4 | A linked non-custodial web wallet | `wallet_account_links` → `wallet_addresses` |

If none produce an address the result is `PAYEE_REQUIRED`, which clients render
as "enter a payee address" — never as a silent success.

### The bug this fixes

`POST /api/invoices/[id]/send` previously did:

```ts
merchant_wallet_address: invoice.merchant_wallet_address || '',
```

`createPayment` treats a missing merchant wallet as "use the platform wallet", so
an invoice created without a wallet on file would settle the merchant's ~99% net
into the platform's own wallet rather than failing. The empty-string fallback is
gone; `send` now resolves or refuses.

### Where it is enforced

| Path | Behaviour |
|------|-----------|
| `POST /api/invoices` | Resolves a payee when `crypto_currency` is set; 400 `PAYEE_REQUIRED` if undeterminable |
| `PUT /api/invoices/[id]` | Re-resolves whenever the coin or address is touched; a coin switch discards the stale address |
| `POST /api/invoices/[id]/send` | Last gate — resolves or refuses; persists what it settled on |
| `POST /api/proposals` | Merchant's opening offer must name a payee when it names a coin |
| `POST /api/proposals/[id]/counter` | Same rule for counter-offers |
| `POST /api/proposals/[id]/accept` | Final gate before an invoice can exist |

The UI mirrors the rule: the invoice and proposal forms show a required payee
field as soon as a coin is chosen — prefilled from the account when known,
blank-and-required when not. The coin dropdown now lists every supported coin,
marking the ones with no wallet on file, so a business can invoice in a coin it
has no stored wallet for as long as an address is entered.

---

## 2. Connecting a web wallet

The web wallet (`wallets` + `wallet_addresses`) is anonymous by design — public
keys only, no owner column. Rather than adding `merchant_id` to it, an explicit,
revocable link table bridges the two:

```
wallet_account_links (wallet_id, merchant_id, business_id?, label, is_default)
```

`business_id` NULL means account-level (usable by every business); set means
scoped to that one business. Partial unique indexes keep one link per scope and
at most one default per scope.

### Proving ownership

Linking requires a signed auth challenge, the same proof the wallet uses to
authenticate itself elsewhere. Without it anyone could claim any `wallet_id` and
start receiving another user's invoice payouts. The browser flow
(`src/lib/wallets/connect-web-wallet.ts`) unlocks the wallet locally, signs a
server-issued challenge, and sends only the signature — the password and mnemonic
never leave the page.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/wallets/links` | Linked wallets + their receive addresses |
| `POST` | `/api/wallets/links` | Link a wallet (challenge + signature required) |
| `PATCH` | `/api/wallets/links/[id]` | Rename, or make default for its scope |
| `DELETE` | `/api/wallets/links/[id]` | Unlink (wallet and imported addresses untouched) |
| `POST` | `/api/wallets/links/[id]/import` | Copy addresses into global/business wallets |

Linking alone is enough to make the wallet a payee source; importing is a
convenience so the addresses also appear in the older wallet stores. Import never
overwrites an existing entry unless `overwrite` is passed.

### Post-login landing

`GET /api/auth/landing` decides where a user goes after signing in. It sends them
to `/settings/wallets` when:

- the account has **no payee source at all** — every invoice would stall, or
- they have **not signed in for 30+ days** — an address that was right months ago
  may point at a wallet they no longer control.

The second prompt stands down once they actually view the page
(`wallets_reviewed_at`). An explicit `?redirect=` always wins, and any failure
falls back to the dashboard — a wallet nudge never blocks a sign-in.

---

## 3. Proposals

A proposal is a quote under negotiation. Every offer and counter-offer is an
immutable row in `proposal_revisions`; `proposals.current_revision_id` points at
the standing one. `proposal_events` is an append-only audit trail.

### Statuses

```
draft ──send──▶ sent ──counter──▶ countered ──┐
                 │                     │       ├─▶ accepted ──convert──▶ invoice
                 └─────────────────────┴───────┼─▶ rejected
                                               ├─▶ withdrawn
                                               └─▶ expired
```

`sent` and `countered` are the live states; everything else is terminal.

### Who can do what

- **Either party may counter** while the proposal is live.
- **Neither party may accept its own standing offer** — only the side that did
  not author it can close it. That one rule covers both directions.
- **The client never sets the payee.** A client counter inherits the standing
  payee when the coin is unchanged; if they ask for a *different* coin the payee
  is left unset, and the merchant must supply one when they accept.

### Client access

The client has no CoinPay account. They act through an opaque `access_token`
link (`/proposals/respond/<token>`). Withdrawing rotates the token so the old
link genuinely stops working rather than just flipping a status the client never
sees. Draft proposals are unreachable by token.

### Notifications

Every change that hands the ball over emails the *other* side
(`src/lib/proposals/notify.ts`): the client gets the token link, the merchant
gets the dashboard link. Delivery is best-effort — the state change is already
committed by then, so a bounced email is logged and swallowed rather than
failing the request or rolling anything back.

### Endpoints

| Method | Path | Actor |
|--------|------|-------|
| `GET`/`POST` | `/api/proposals` | merchant |
| `GET`/`DELETE` | `/api/proposals/[id]` | merchant |
| `POST` | `/api/proposals/[id]/send` | merchant |
| `POST` | `/api/proposals/[id]/counter` | merchant |
| `POST` | `/api/proposals/[id]/accept` | merchant |
| `POST` | `/api/proposals/[id]/reject` | merchant |
| `POST` | `/api/proposals/[id]/withdraw` | merchant |
| `POST` | `/api/proposals/[id]/convert` | merchant |
| `GET`/`POST` | `/api/proposals/respond/[token]` | client |

Only drafts can be deleted; anything the client has seen is withdrawn instead, so
their record of the negotiation is never silently erased.

---

## Migrations

| File | Adds |
|------|------|
| `20260731100000_link_web_wallets_to_accounts.sql` | `wallet_account_links` |
| `20260731110000_create_proposals.sql` | `proposals`, `proposal_revisions`, `proposal_events` |
| `20260731120000_merchant_login_activity.sql` | `merchants.last_login_at`, `merchants.wallets_reviewed_at` |
