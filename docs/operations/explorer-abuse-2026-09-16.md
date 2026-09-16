# Explorer abuse, 2026-09-16

Production was running commit 34bfdbf with the security proxy active. The
per-IP daily limiter was refusing traffic, including a sampled minute with
1,369 requests from 796 IPs and 1,303 daily refusals. It did not bound a fleet
that rotated addresses.

Read-only investigation at approximately 03:37 UTC:

- Crawlproof project 69420039-675a-4c3e-95ec-c8287fc21cc5 had 23,486 explorer
  events in the preceding 24 hours, including 20,056 pageviews. Of those,
  19,913 pageviews shared the exact user agent below.
- The latest 1,000 events included 990 matching that UA; 987 were labelled SG.
  These are analytics geography labels, not attribution to a person/location.
- A Railway successful-request sample from 03:23:13–03:32:14 contained 763
  explorer detail reads from 752 IPs across 761 distinct paths. All matched
  the same UA. That sample is not the total attack volume.

```
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36
```

## Enforcement

- Anonymous visitors share 2,000 free explorer reads per UTC day and 60/minute,
  in addition to the existing per-IP limits.
- Verified dashboard sessions get 2,000 free reads per account per UTC day,
  separate from the anonymous pool. Cookie or bearer JWTs must have a valid
  signature, expiration, email and userId. Refresh tokens do not qualify.
  Renewing a session or changing IP does not replenish the account budget.
- Exhausted free budgets use the existing explorer payment gateway. A verified
  pass can continue reading, subject to abuse enforcement and burst limits.
- Anonymous traffic with the same browser capability-header fingerprint reaching
  60 requests from at least 20 IPs within five minutes is banned for one hour.
  These anonymous cohort bans are in memory and reset on restart.
- Verified accounts exceeding 120 attempted explorer reads/minute receive
  escalating Fibonacci bans: 1, 2, 3, 5, 8, 13 ... minutes, capped at 24 hours.
  Each new abusive window after expiry advances one strike. Requests during
  an active ban neither advance strikes nor extend its expiry. Account history
  and active bans persist under `explorer/bans` across sessions and deployments;
  strikes do not automatically reset. `Retry-After` reports remaining seconds.
  Unavailable or corrupt ban storage fails closed for one minute.
- Explicit EXPLORER_BANNED_FINGERPRINTS and EXPLORER_BANNED_ACCOUNTS accept
  comma-separated fingerprint hashes or account IDs. These bans persist through
  deployment configuration and apply before any paid-pass handling.
- Ban responses are 403 with no-store and security headers. Login, pricing and
  the pass page are outside the explorer ban.
- A fingerprint is SHA-256 of an allowlist of browser headers, excluding IP,
  cookies, credentials, URL and request IDs. Ban logs include the fingerprint,
  bounded header profile, request count and distinct-address count for review.
  Matching fingerprints are cohorts, not reliable personal identities. Real
  anonymous users with identical headers can be grouped with a fleet; verified
  accounts are assessed independently unless explicitly banned.

## Persistence and operations

Daily counters are written before admission under
`${RAILWAY_VOLUME_MOUNT_PATH:-/mnt/files}/explorer`. Account filenames hash the
account ID. Atomic replacement and an exclusive directory lock prevent lost
updates during deployment overlap; locks left after a crash expire after one
minute. Storage failures fail closed to the payment gateway. The current
production service has one instance and a persistent volume. Multiple replicas
on separate volumes would need a shared atomic database counter.

EXPLORER_SHARED_FREE_PER_DAY defaults to 2000 and
EXPLORER_SHARED_FREE_PER_MINUTE defaults to 60. Account allowance is 2000/day.
UTC midnight replenishes daily budgets; deployments do not.

Inspect `[explorer-abuse]` for detected cohorts and `[explorer]` for refusal
counts (`abuse`, `shared-daily`, `shared-burst`, `account-daily`, and storage
unavailability). Do not block every Chrome/145 user or every SG visitor merely
on those attributes. Header rotation can evade fingerprint bans, so the shared
cost ceiling remains necessary.
