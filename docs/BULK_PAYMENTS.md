# Bulk payments (`window.coinpay.payBatch`)

Pay many recipients from one wallet approval. Built for payables runs — e.g.
ugig.net's "Accepted" invoice queue, where paying 62 invoices one at a time is
about an hour of clicking.

## The shape of it

```
web page                content script        background worker        CoinPay API
────────                ──────────────        ────────────────        ───────────
window.coinpay
  .payBatch(payments) ──► relay ────────────► validate + origin check
                                              open approval window
                                                   │
                                            user approves ONCE
                                                   │
                                              for each payment:
                                                prepare ──────────────► POST prepare-tx
                                                sign (local, in worker)
                                                broadcast ────────────► POST broadcast
                                                   │
                        ◄── progress events ◄──────┤
  results ◄──────────────────────────────────◄─────┘
```

Keys never leave the background worker. The server assembles unsigned
transactions (nonce, UTXOs, blockhash, fees) and relays signed blobs to the
network — the same split the CoinPay web wallet already uses.

## Page API

```js
if (!window.coinpay) return; // extension not installed

await window.coinpay.connect(); // idempotent; prompts once per origin

const { results } = await window.coinpay.payBatch(
  [
    { id: 'invoice-1', chain: 'usdc_pol', to: '0xabc…', amount: '25.00',
      label: 'Ada Lovelace — Fix login bug', amountUsd: 25 },
    { id: 'invoice-2', chain: 'btc', to: '1BvBM…', amount: '0.00041', amountUsd: 25 },
  ],
  { onProgress: (p) => console.log(p.id, p.stage, `${p.completed}/${p.total}`) },
);

for (const r of results) {
  // r.status: 'sent' | 'failed' | 'skipped'
  // r.txHash, r.explorerUrl when sent; r.error otherwise
}
```

`chain` accepts CoinPay currency codes (`usdc_pol`, `btc`) or chain names
(`USDC_POL`). Supported: BTC, BCH, ETH, POL, SOL, USDC/USDT on ETH/POL/SOL.
Anything else is rejected up front rather than guessed — guessing a chain sends
real funds to the wrong network.

## Partial success is the contract

There is no atomic 62-way transfer; each payment is its own transaction. So
`payBatch` **resolves even when some payments fail** and reports per-item
status. It rejects only if the user declines or the batch never starts.

Callers must reconcile from `results`, not from the promise resolving.

## Ordering and why it is slow-ish

Transactions on the same account go one at a time, because the server derives
chain state per `prepare-tx`:

| chain | state | hazard if parallel |
|---|---|---|
| EVM | `eth_getTransactionCount(from,'pending')` | two txs get the same nonce; the second *replaces* the first |
| BTC/BCH | full UTXO set spent, one change output | the next tx builds from already-spent inputs |
| SOL | recent blockhash | expires quickly |

So payments are grouped into per-account queues. Queues run concurrently (a
Solana payment never waits on a Polygon one), but within a queue it is strictly
prepare → sign → broadcast → settle delay → next. Delays are 1.5s (EVM), 1s
(SOL), 8s (UTXO — a change output must reach the indexer).

Those delays are heuristics, so transient chain-state errors (`nonce too low`,
`missingorspent`, `blockhash not found`) are retried with backoff. Terminal
errors — insufficient funds, bad address — fail immediately rather than burning
time or risking a duplicate.

**Rough wall-clock:** ~4s per payment on one EVM/SOL account, ~10s on BTC. 62
same-chain payments ≈ 4 minutes; spread across chains it is faster.

### Payment-request expiry

CoinPay quotes crypto amounts at the market rate and the quote holds ~15
minutes. A large single-chain BTC batch can approach that window. Mitigations:

- Split very large BTC/BCH runs into batches.
- Prefer USDC/SOL rails for payables — faster settle delays, stable amounts.
- The integrating app should re-check `expires_at` and re-quote anything stale.

## Security model

- **Origin is stamped by the browser** (`sender.origin`), never taken from the
  page. A page cannot claim to be a different site.
- **Connecting ≠ spending.** A connection grants read access to public
  addresses and the right to *ask*. Every batch opens its own approval window.
- **The approval window shows every recipient**, per-chain totals, and the grand
  total. Nothing is hidden behind "and 59 more".
- **Approval requires unlocking**; the seed stays in the background worker and
  per-chain keys are zeroed right after each signature.
- **Closing the approval window cancels the remainder.** Already-broadcast
  payments cannot be recalled, and their results still return.
- Duplicate `id`s in one batch are rejected — for a payables run that ambiguity
  is how someone gets paid twice.
- Batch size is capped at 500.

## Adding a new site

The extension only injects into origins listed in the manifest. To support
another domain, add it to **all three** lists in
`manifest/manifest.{chrome,firefox}.json`:

```jsonc
"host_permissions": ["https://example.com/*"],   // API + progress relay
"content_scripts": [{ "matches": ["https://example.com/*"] }],
"web_accessible_resources": [{ "matches": ["https://example.com/*"] }]
```

`src/__tests__/packaging.test.ts` enforces that the three agree — if the bridge
can run somewhere it cannot fetch the provider, `window.coinpay` silently never
appears.

## Portal registration

On the first batch the extension registers with the portal via
`POST /api/web-wallet/import`: public keys, addresses, and a signature proving
key ownership. **The seed is never uploaded.** The returned `wallet_id` is
cached in `storage.local` and cleared on re-import.

Every payable chain gets its own `wallet_addresses` row — including token chains
— because `prepare-tx` verifies `from_address` against the exact chain, so
`USDC_POL` needs a row even though it reuses the EVM address.

Subsequent calls authenticate per request by signing
`METHOD:path:timestamp:body` with the ETH-path secp256k1 key (compact ECDSA,
SHA-256 prehash). `src/core/__tests__/api.test.ts` verifies this against a
byte-for-byte copy of the server's verifier.

## Key derivation parity

The extension signs with keys derived in `src/core/private-keys.ts`, but its
funds sit at addresses derived by the `@profullstack/coinpay` SDK (which does
not export private keys). `src/core/__tests__/private-keys.test.ts` derives each
key, recomputes its address independently, and asserts it equals the SDK's
`deriveAddress()` — so a divergence fails the build instead of signing with a
key that controls a different address.
