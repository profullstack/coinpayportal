# Web Bot Auth

Cryptographic identity for automated traffic. A bot signs its request with an
Ed25519 key and publishes the matching public key at a well-known URL; the
origin verifies the signature and learns **which** agent is calling, instead of
guessing from a `User-Agent` string that anyone can type.

CoinPay implements both halves:

- **Verifier** — check signatures on requests arriving at your origin, and
  resolve the signing key to a CoinPay DID and trust tier.
- **Directory** — publish keys for CoinPay-hosted agents at
  `/.well-known/http-message-signatures-directory`, so those agents are
  verifiable by anyone who speaks Web Bot Auth, Cloudflare included.

The point of pairing this with x402: identity, permission and payment resolve at
the same hop. Cloudflare does that at their edge for sites behind their CDN.
CoinPay does it for any origin.

## The wire format

Three headers, per the IETF HTTP Message Signatures drafts (RFC 9421):

```
Signature-Agent: "https://signature-agent.test"
Signature-Input: sig1=("@authority" "signature-agent");created=1735689600;keyid="poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";alg="ed25519";expires=1735689900;tag="web-bot-auth"
Signature: sig1=:jdq0SqOwHdyHr9+r5jw3iYZH6aNGKijYp/EstF4RQTQdi5N5YYKrD+mCT1HA1nZDsi6nJKuHxUi/5Syp3rLWBA==:
```

- `tag` **must** be `web-bot-auth`. Signatures tagged anything else are ignored.
- `keyid` is the RFC 7638 JWK thumbprint (base64url) of the signing key.
- `alg` is `ed25519`. Nothing else is accepted.
- `Signature-Agent` points at the key directory. It is a structured-field
  String, so the quotes are part of the value.

### What must be covered

At minimum `@authority`. It is what stops a signature captured at one origin
being replayed against another. Cover anything else whose integrity matters —
if you send a budget or a price header, sign it, or a middlebox can rewrite it.

Components must resolve to ASCII. A non-ASCII value cannot round-trip through
the signature base and is rejected rather than signed over in mangled form.

### Freshness

`created` and `expires` are both honoured, with 300s of clock-skew tolerance.
A signature valid for more than **one hour** is rejected outright: at that
point it is a bearer token, and anyone who observes it can replay it for as
long as it lives. Keep them short — minutes, not hours.

## Verifying requests

```javascript
const res = await fetch('https://coinpayportal.com/api/web-bot-auth/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'cp_live_xxxxx' },
  body: JSON.stringify({
    method: request.method,
    url: request.url,
    headers: {
      'signature': request.headers.get('signature'),
      'signature-input': request.headers.get('signature-input'),
      'signature-agent': request.headers.get('signature-agent'),
    },
  }),
});

const result = await res.json();
```

A verified, registered agent comes back as:

```json
{
  "verified": true,
  "keyid": "poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U",
  "agent_origin": "https://bot.example",
  "covered_components": ["@authority", "signature-agent"],
  "identity": { "known": true, "did": "did:web:bot.example", "label": "Crawler v2" },
  "trust": { "tier": "B", "score": 64, "label": "Good", "risk_level": "medium" }
}
```

An unsigned or badly signed request returns **HTTP 200** with
`verified: false` and a `reason`. That is not an error — on a public endpoint
most callers are unsigned, and what to do about it is your decision, not the
facilitator's.

### Reading the result honestly

Three distinct states, easy to conflate and expensive to get wrong:

| State | Meaning |
|---|---|
| `verified: false` | No usable signature. You know nothing about the caller. |
| `verified: true`, `identity.known: false` | The caller **is** who they say they are, cryptographically. They have simply never registered with CoinPay. |
| `verified: true`, `identity.known: true` | Verified *and* bound to a DID, with a trust tier attached. |

`known: false` means **unknown, not untrusted**. Every legitimate agent that has
never registered here looks exactly like that. Blocking on it blocks the honest
majority.

`trust` is `null` unless the key is bound to a DID with enough history to score.

### Failure reasons

| `reason` | Meaning |
|---|---|
| `missing_headers` | No `Signature`/`Signature-Input`, or no `Signature-Agent` |
| `no_web_bot_auth_signature` | Signatures present, none tagged `web-bot-auth` |
| `missing_keyid` | No `keyid` parameter |
| `unsupported_algorithm` | `alg` is not `ed25519` |
| `expired` / `not_yet_valid` | Outside the `created`/`expires` window |
| `lifetime_too_long` | Valid for more than an hour |
| `unknown_key` | `keyid` is not in the agent's directory |
| `directory_error` | The directory could not be fetched or parsed |
| `bad_signature` | Signature did not verify over the reconstructed base |
| `malformed` | Unparseable headers, or a covered component absent from the request |

`directory_error` is deliberately distinct from `bad_signature`: an unreachable
directory is an availability problem, not evidence of a forgery.

## Registering a key

Binding a key to a DID is what turns an anonymous-but-verified caller into one
with a reputation.

```bash
curl -X POST https://coinpayportal.com/api/web-bot-auth/keys \
  -H "authorization: Bearer $COINPAY_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "jwk": { "kty": "OKP", "crv": "Ed25519", "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" },
    "signature_agent": "https://bot.example",
    "agent_did": "did:web:bot.example",
    "label": "Crawler v2"
  }'
```

Returns `201` with the `keyid` your signer must put in `Signature-Input`.

Notes:

- The thumbprint is **always recomputed** from the JWK. It is the join key
  between a signature and an identity, so it is never taken from input.
- `agent_did` must already be registered to your account, or you get `403`.
  Otherwise anyone could bind their key to someone else's reputation.
- A registration is scoped to its `signature_agent`. Republishing another
  operator's public key at your own directory does **not** inherit their
  identity — the origin is checked at resolve time.
- Only `kty`/`crv`/`x` are stored. A JWK containing a private `d` is rejected
  outright rather than quietly stripped, because an operator who pastes one
  needs to know it was exposed.

## Publishing keys (the directory)

Set `published: true` to have CoinPay serve a key from its own directory at
`/.well-known/http-message-signatures-directory`, with content type
`application/http-message-signatures-directory+json`.

A published key cannot also declare an external `signature_agent` — two
directories claiming the same key would disagree about who owns it.

The directory is cached for 300s. Keep it short: verifiers re-read it to pick up
rotations and revocations, and a long TTL keeps a revoked key alive downstream.

## Fetching directories safely

Verification fetches a URL supplied by the caller, which is a
server-side-request-forgery primitive if left open. The fetch is therefore
HTTPS-only, redirect-refusing, 5s-timeout, 128KB-capped, and rejects private and
link-local address literals (`localhost`, `127.0.0.0/8`, `10/8`,
`192.168/16`, `172.16/12`, `169.254/16`, IPv6 ULA/loopback).

This blocks address literals. It is **not** complete DNS-rebinding protection —
a hostname that resolves to an internal address at connect time will still be
attempted. Run it somewhere without interesting internal services, or put an
egress policy in front of it.

## What this does not do

- **No nonce replay cache.** `nonce` is parsed but not checked against a store,
  so a signature can be replayed within its validity window. Short `expires`
  values are what bound the exposure. Cloudflare does not validate nonces today
  either.
- **No allowlist of known operators.** CoinPay verifies signatures and resolves
  registered keys; it does not maintain a curated list of "real" crawler
  operators the way a CDN does.
- **No purpose signal.** Distinguishing search from agent from training traffic,
  and pricing those differently, is a separate piece of work.

## References

- [RFC 9421 — HTTP Message Signatures](https://www.rfc-editor.org/rfc/rfc9421.html)
- [RFC 7638 — JWK Thumbprint](https://www.rfc-editor.org/rfc/rfc7638.html)
- [RFC 8037 — Ed25519 for JOSE](https://www.rfc-editor.org/rfc/rfc8037.html)
- [Cloudflare: Web Bot Auth](https://developers.cloudflare.com/bots/concepts/bot/verified-bots/web-bot-auth/)
- [`docs/X402_INTEGRATION.md`](./X402_INTEGRATION.md) — the payment half
