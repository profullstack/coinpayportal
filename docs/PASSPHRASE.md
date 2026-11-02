# Passphrase sign-in

Sign in to CoinPay with a sentence you can remember, instead of (or as well as)
a password or passkey. Turn it on at **Settings → Security → Passphrase**.

## What the phrase looks like

By default CoinPay writes one for you: a silly 12-word scene such as

> fuzzy purple walrus juggles a rusty trumpet under the sleepy volcano loudly

Every slot is a crypto-random pick from a fixed list (adjective, colour, noun,
verb, adjective, noun, preposition, adjective, noun, adverb), which is exactly
71 bits. People remember a picture far better than 12 unrelated seed words.
You can shuffle until one sticks, or write your own (at least 6 different
words; song lyrics, quotes and verses are guessable however they are twisted).

Typing is forgiving: capitals, punctuation, extra spaces and the words
"a", "an" and "the" are ignored.

## How it works

- The phrase never leaves the browser. It is normalized and stretched with
  scrypt (N=2^17, r=8, p=1, 128 MiB, a per-account random salt) into an
  Ed25519 key.
- The server stores only the public key, the salt and the KDF parameters
  (`passphrase_credentials`). A stolen database gives an attacker a slow,
  memory-hard guessing job against 71 bits, not the phrase.
- Login: `POST /api/auth/passphrase/login-options {email}` returns the salt,
  KDF and a single-use 5-minute challenge; the browser signs
  `coinpayportal passphrase login v1\n<challenge>\n<email>` and sends it to
  `POST /api/auth/passphrase/login-verify {challengeKey, signature}`.
  Verification is strict RFC 8032 and small-order keys are refused.
- Unknown emails get a stable decoy salt, so the options call does not reveal
  who has an account. Verify shares the password login's rate limits.
- Setting, replacing or removing a phrase (`POST`/`DELETE
  /api/auth/passphrase`) requires your current password, so an API key or a
  stolen session cannot add itself a permanent login.

Trade-off: unlike a passkey, a phrase can be typed into a phishing site. Only
enter it on coinpayportal.com.

## Passing it on with deadman.switch

After you turn it on, CoinPay offers to pass the phrase to your heirs through
[deadman.switch](https://deadman.switch.pit.world/): copy the phrase, seal it
in a switch's note (sealed in your browser, released only if you stop checking
in), and give your people the switch's opening passphrase. CoinPay never sends
the phrase anywhere itself.
