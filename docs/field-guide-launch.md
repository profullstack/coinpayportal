# CoinPayPortal founder's field guide: release checklist

## What this change adds

- A homepage-only hero-level promotion, without replacing the existing payment demo or wallet UI.
- `/get-guide`: name, email, business/project, region and optional role; immediate PDF download after successful storage; truthful email-delivery status.
- Separate, unchecked marketing and regional-call preferences. Required privacy acknowledgment is not marketing consent.
- `/api/field-guide`: bounded JSON, validation, same-origin browser checks, honeypot, server-only storage and atomic database-backed abuse limits.
- A private lead table and service-role-only RPC. No anonymous lead-list endpoint. Raw IP addresses are not stored.
- An optional regional setup call on the confirmation screen using the official contact page, support@coinpayportal.com, and (888) 526-4640.
- An expected-asset manifest and release check that fails if the PDF is absent or changed.

## Required release asset

Commit the supplied **Edition 1.3 PDF** at:

`public/guides/coinpayportal-los-gatos-field-guide-edition-1-3.pdf`

The 69-page file is 658102 bytes and has SHA-256:

`c44bc9f86f0c9a66ec758ca3a7af816a0efd3fb882feed8d39fa2e66f78c6457`

It retains the existing branded book, Mercury/moomoo sections, citations, and human/agent tips. Changes: complimentary-PDF edition labeling; regional setup callouts on pages 18, 39 and 69; official email, phone and contact links. No new tax-law claims or professional-review claims were added. The proposed $19 ebook sales examples elsewhere remain examples, not a checkout price or claimed former price for this promotion.

The PDF is supplied with the ChatGPT delivery package. A sandbox attachment link is **not** a website asset and must not be pasted into application code. The PR must not be released until the actual bytes are committed and the asset check passes.

## Before merge

1. Add the exact PDF to this branch and run `node scripts/verify-field-guide.mjs`.
2. Apply `supabase/migrations/20261004160000_field_guide_leads.sql` in staging, test, then apply the additive migration to the production database using the established deployment process. Do not assume a code deployment automatically applies SQL.
3. Confirm the app has `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the existing Resend or Mailgun email configuration. No client-side secrets are introduced.
4. Run `node --test scripts/field-guide.smoke.mjs`, the repository type check, tests and production build. The first command tests pure validation, bounded JSON and email escaping; it is not a browser, database or mail-delivery test.
5. Test anonymous form submission in staging: exactly one lead is stored, the correct PDF downloads, and the one-time email is received. Verify the browser success view reports email failure truthfully when the mail provider is unavailable.
6. Verify malformed/oversized requests, missing PDF, unavailable database, replay/rate limiting, keyboard-only use, mobile layout and non-homepage suppression of the promotion.
7. Verify the reverse proxy overwrites client IP headers. Limits are 5 requests per IP/15 minutes, 1 per email/15 minutes, and 500 globally/24 hours. The global cap also bounds email-provider spend. Global exhaustion needs operator review; do not silently remove this control.
8. Confirm the current privacy notice covers this collection and the team's retention/deletion procedure. Marketing preference alone is not address verification: there is no marketing subscription or automated campaign in this change. Require a verified opt-in and unsubscribe handling before exporting any lead to a campaign. Do not treat `email_verified_at IS NULL` as verified.
9. Test lead access as anon/authenticated roles: table reads/writes and RPC calls must be denied. Access/export is an explicitly authorized server/admin operation.

## After merge

Use the repository's existing deploy-to-dev2 workflow. Verify the deployed homepage, `/get-guide`, the PDF content type/checksum and a controlled end-to-end submission. Do not report the guide as live solely because a PR merged or a health endpoint returns 200.

The PDF is a public static asset, matching ThreatCrush's soft-gate pattern. The form captures leads; it is not authentication, DRM, or protection against sharing a direct URL. Do not put sensitive information in the book.

Optional calls and implementation work are separately scoped; no consultation price, guaranteed availability, CPA service or attorney service is represented. Mercury and moomoo recommendations remain editorial preferences rather than universal rankings or sponsorship claims.

## Rollback

Revert the feature commit and redeploy. The additive tables can remain private; do not delete captured leads merely to revert the UI. Resolve any retention/deletion request through the authorized data-handling process.
