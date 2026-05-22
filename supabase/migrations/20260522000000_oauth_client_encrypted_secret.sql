-- Store a client-side-encrypted copy of an OAuth client's `client_secret`
-- so the owner can re-reveal it after creation. The plaintext secret never
-- touches the server again after the initial creation moment — the browser
-- encrypts with a user-supplied passphrase (PBKDF2 + AES-256-GCM via
-- WebCrypto) and posts the ciphertext here.
--
-- `client_secret` (the bcrypt hash used for token-endpoint verification) is
-- unchanged and still authoritative for OAuth flows.

alter table public.oauth_clients
  add column if not exists client_secret_encrypted text;

comment on column public.oauth_clients.client_secret_encrypted is
  'Client-side AES-256-GCM ciphertext of the plaintext client_secret. Format: "v1:<base64-salt>:<base64-iv>:<base64-ciphertext>". Owner-only.';
