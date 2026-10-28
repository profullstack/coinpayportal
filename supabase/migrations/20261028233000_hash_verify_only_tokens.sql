-- Verify-only bearer tokens are stored as sha256, never raw (2026-10-28).
--
-- oauth_refresh_tokens.token and outrank_integrations.access_token (kind
-- 'outrank') are only ever compared against a presented bearer, so the raw
-- value has no business being in the database. New rows are written as
-- 'sha256:<hex>' by the app. This hashes existing rows in place.
--
-- Apply AFTER the app that understands both forms is deployed: the token
-- route and the Outrank webhook look up hash and raw, so there is no window
-- in which a live token stops working.
--
-- NOT hashed: outrank_integrations rows of kind 'crawlproof'. That bearer is
-- also the Standard-Webhooks HMAC secret the receiver needs in the clear to
-- verify each delivery's signature.

update public.oauth_refresh_tokens
   set token = 'sha256:' || encode(sha256(convert_to(token, 'UTF8')), 'hex')
 where token not like 'sha256:%';

update public.outrank_integrations
   set access_token = 'sha256:' || encode(sha256(convert_to(access_token, 'UTF8')), 'hex')
 where kind = 'outrank'
   and access_token not like 'sha256:%';

comment on column public.oauth_refresh_tokens.token is
  'sha256:<hex> of the refresh token; the token itself is only ever returned to the client';
