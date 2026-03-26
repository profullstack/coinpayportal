# Multi-Wallet Support — Web Wallet

## Problem

The web wallet stores a single wallet's data (encrypted seed, derived keys, addresses) in `localStorage`. Users who create or import multiple wallets on the same browser can only access one at a time. Switching requires clearing localStorage and re-importing the seed phrase.

## Goal

Allow users to manage multiple wallets from the same browser with a wallet selector UI. No seed re-import needed when switching.

## Current Architecture

### localStorage Keys
- `coinpay_wallet_id` — current wallet UUID
- `coinpay_wallet_encrypted` — AES-encrypted seed phrase (password-protected)
- `coinpay_wallet_public_keys` — ed25519 + secp256k1 public keys
- `coinpay_wallet_addresses` — derived chain addresses (BTC, ETH, SOL, etc.)

### Auth Flow
1. User creates/imports wallet → seed encrypted with password → stored in localStorage
2. User unlocks wallet → password decrypts seed → session active
3. Auth challenge/verify via `/api/web-wallet/auth/*` endpoints

### DB Tables
- `wallets` — one row per wallet (public keys, status, LN config)
- `wallet_addresses` — derived addresses per wallet

## Proposed Design

### localStorage Changes

Replace single-wallet keys with a wallet registry:

```
coinpay_wallets = {
  "wallet-uuid-1": {
    id: "wallet-uuid-1",
    label: "Main Wallet",
    encrypted_seed: "...",
    public_keys: { ed25519: "...", secp256k1: "..." },
    created_at: "2026-03-26T..."
  },
  "wallet-uuid-2": {
    id: "wallet-uuid-2", 
    label: "Trading Wallet",
    encrypted_seed: "...",
    public_keys: { ed25519: "...", secp256k1: "..." },
    created_at: "2026-03-20T..."
  }
}

coinpay_active_wallet = "wallet-uuid-1"
```

### Migration

On first load with old format:
1. Read existing `coinpay_wallet_*` keys
2. Convert to new `coinpay_wallets` registry format
3. Set `coinpay_active_wallet` to existing wallet ID
4. Remove old keys
5. Seamless — user sees no change

### Wallet Selector UI

**Location:** Top of web wallet dashboard, above balance

**Component:** `WalletSelector`

```
┌─────────────────────────────────────┐
│ 🔑 Main Wallet          ▼          │
│    B3zn7yeo...yqkKpr               │
├─────────────────────────────────────┤
│ 🔑 Trading Wallet                  │
│    7EcDhSYG...FLtV                 │
├─────────────────────────────────────┤
│ + Create New Wallet                 │
│ ↓ Import Wallet                     │
└─────────────────────────────────────┘
```

**Features:**
- Dropdown showing all wallets with label + truncated address
- Active wallet highlighted
- Click to switch (requires password unlock if locked)
- "Create New" and "Import" options at bottom
- Edit wallet label (pencil icon)
- Delete wallet (with confirmation + seed backup warning)

### Switching Logic

1. User selects different wallet from dropdown
2. If wallet is locked → show unlock modal (password)
3. On unlock → set `coinpay_active_wallet` to new ID
4. Refresh dashboard with new wallet's data
5. Auth token is per-wallet (JWT contains wallet_id)

### Password Handling

Each wallet has its own password-encrypted seed. Options:

**Option A: Separate passwords per wallet**
- More secure
- User needs to remember multiple passwords
- Unlock required on each switch

**Option B: Single master password encrypts all wallets**  
- Better UX
- One password decrypts all seeds
- Less secure if compromised

**Recommendation:** Option A (separate passwords) — matches industry standard (MetaMask, Phantom). Users can use the same password for all wallets if they want.

### Files to Modify

#### New Files
- `src/lib/web-wallet/wallet-registry.ts` — CRUD for multi-wallet localStorage
- `src/components/web-wallet/WalletSelector.tsx` — dropdown UI
- `src/lib/web-wallet/migration.ts` — single→multi wallet migration

#### Modified Files
- `src/lib/web-wallet/client-crypto.ts` — read/write from registry instead of flat keys
- `src/app/web-wallet/page.tsx` — add WalletSelector to dashboard
- `src/app/web-wallet/create/page.tsx` — create adds to registry
- `src/app/web-wallet/import/page.tsx` — import adds to registry
- `src/app/web-wallet/unlock/page.tsx` — unlock targets active wallet
- `src/components/web-wallet/WalletHeader.tsx` — show active wallet label

### API Changes

None — the API already works per-wallet via `wallet_id` in the JWT. The wallet selector just changes which wallet's JWT is used.

### Edge Cases

- **Max wallets:** Cap at 10 per browser (localStorage size limit ~5MB)
- **Wallet deletion:** Warn about seed backup, require password confirmation
- **Corrupt data:** If registry is corrupted, offer recovery via seed import
- **Cross-tab:** Use `storage` event listener to sync active wallet across tabs

### Testing

- Migration from single to multi wallet format
- Create/import adds to registry correctly
- Switch wallets updates UI + auth context
- Delete wallet removes from registry
- Password per wallet (can't unlock wallet A with wallet B's password)
- localStorage size limits
- Cross-tab sync

## Estimated Effort

- **Migration logic:** 1-2 hours
- **Wallet registry lib:** 2-3 hours  
- **WalletSelector UI:** 2-3 hours
- **Update existing pages:** 2-3 hours
- **Tests:** 2-3 hours
- **Total:** ~10-14 hours

## Priority

Medium — workaround exists (clear cache + re-import). But needed for power users managing multiple wallets (e.g., personal + business).
