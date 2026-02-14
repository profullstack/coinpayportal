# Lightning Network Integration

## Overview

CoinPayPortal Wallet Mode supports the **Lightning Network** via **BOLT12 offers**, powered by Greenlight (CLN-as-a-service by Blockstream). This enables instant, low-fee Bitcoin payments alongside the existing on-chain wallet.

---

## How Lightning Works with the Web Wallet

### Same Seed, Same Backup

The Lightning node identity is derived from the **same BIP39 mnemonic** used for on-chain wallets. Specifically:

- **On-chain keys:** Standard BIP44 derivation paths (`m/44'/0'/0'` for BTC, etc.)
- **Lightning keys:** Custom derivation path `m/535'/0'` (535 = "LN" in l33t-speak)

This means:
- **One mnemonic backs up everything** — on-chain and Lightning
- Restoring a wallet from seed automatically recovers the Lightning node identity
- No separate Lightning backup is needed

### Architecture

```
BIP39 Mnemonic
    │
    ├── m/44'/0'/0'  → BTC on-chain addresses
    ├── m/44'/60'/0' → ETH addresses
    ├── m/535'/0'    → Lightning node identity (Greenlight)
    └── ...other chains
```

The Greenlight service runs CLN (Core Lightning) nodes in the cloud. Your wallet's seed deterministically derives the node's private key, so only you control the node.

---

## Enabling Lightning on a Wallet

1. **Create or import a wallet** as usual (BIP39 mnemonic)
2. **Click "Enable Lightning"** — this calls `POST /api/lightning/nodes` with the wallet's mnemonic
3. The server derives Lightning keys from the seed and provisions a Greenlight CLN node
4. The node is immediately **active** and ready to receive payments
5. **The node is persisted** — no need to re-enable Lightning on subsequent visits. The wallet automatically detects the existing node via `GET /api/lightning/nodes?wallet_id=...`

Once enabled, **Lightning (LN) appears in the wallet asset list automatically** alongside BTC, ETH, and other assets.

```typescript
// SDK example — provision a new node
const wallet = await WalletClient.fromSeed('your twelve word mnemonic ...');
const node = await client.lightning.provisionNode({
  wallet_id: wallet.id,
  mnemonic: wallet.getMnemonic(),
});

// SDK example — retrieve existing node on wallet load
const existingNode = await client.lightning.getNodeByWallet(wallet.id);
```

---

## Creating and Sharing BOLT12 Offers

BOLT12 offers are reusable payment requests — like a static invoice that can be paid multiple times.

### Create an Offer

```bash
POST /api/lightning/offers
{
  "node_id": "your-node-id",
  "description": "Coffee ☕",
  "amount_msat": 100000,     // 100 sats (optional — omit for any-amount)
  "currency": "BTC"
}
```

### Share the Offer

Each offer returns a `bolt12_offer` string (starts with `lno1...`) and a `qr_uri` for QR codes:

- **QR Code:** Display `lightning:lno1...` as a QR code
- **Deep Link:** `lightning:lno1...` opens compatible wallets
- **Copy/Paste:** Share the raw `lno1...` string

### Offer Properties

| Property | Description |
|----------|-------------|
| Fixed amount | Set `amount_msat` for exact-amount offers |
| Any amount | Omit `amount_msat` — payer chooses the amount |
| Reusable | A single offer can receive unlimited payments |
| Descriptive | Include a human-readable `description` |

---

## Sending Payments (Send Tab)

The **Send** tab lets you pay BOLT12 offers and invoices directly from the wallet.

1. Navigate to **Lightning → Send**
2. Paste a BOLT12 offer (`lno1...`) or invoice
3. Enter the amount in sats (if the offer doesn't specify a fixed amount)
4. Click **Send Payment**

The wallet calls `POST /api/lightning/payments` with your node ID, the BOLT12 string, and the amount.

```typescript
// SDK example
const payment = await client.lightning.sendPayment({
  node_id: 'your-node-id',
  bolt12: 'lno1...',
  amount_sats: 1000,
});
```

### Payment Flow

1. Your CLN node fetches an invoice from the recipient's offer (via onion message)
2. Payment routes through the Lightning Network
3. On success, the payment status moves to `settled`
4. The payment appears in your transaction history

---

## Receiving Payments (Receive Tab)

The **Receive** tab lets you create BOLT12 offers to receive payments.

1. Navigate to **Lightning → Receive**
2. Enter a description (e.g., "Coffee ☕")
3. Optionally set a fixed amount in sats
4. Click **Create Offer** — a QR code and copyable `lno1...` string are displayed
5. Share the QR code or offer string with the sender

Offers are **reusable** — a single offer can receive unlimited payments.

---

## Payment Settlement

When someone pays your BOLT12 offer:

1. Their wallet fetches an invoice from your CLN node (via onion message)
2. Payment routes through the Lightning Network
3. Your node settles the payment
4. The payment appears in `GET /api/lightning/payments`

### Monitoring Payments

```bash
# List all payments for a node
GET /api/lightning/payments?node_id=your-node-id

# Check a specific payment
GET /api/lightning/payments/payment-hash-here
```

### Payment Statuses

| Status | Meaning |
|--------|---------|
| `pending` | Invoice created, awaiting payment |
| `settled` | Payment received and confirmed |
| `failed` | Payment failed or expired |

---

## Fee Structure

Lightning payments have minimal fees:

| Fee Type | Amount |
|----------|--------|
| Node provisioning | Free |
| Offer creation | Free |
| Receiving payments | 0 base fee + proportional routing fee (~0.01%) |
| Greenlight hosting | Included in CoinPay platform fee |

Lightning fees are orders of magnitude lower than on-chain transaction fees, making it ideal for small/frequent payments.

---

## Security Considerations

- **Non-custodial:** Your seed derives the node keys. CoinPay cannot spend your funds.
- **Deterministic:** Same seed always produces the same node identity.
- **BOLT12 privacy:** Offers use onion messages — payers don't learn your IP or node location.
- **No channel management:** Greenlight handles channel liquidity automatically.
