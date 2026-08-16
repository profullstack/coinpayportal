<?php
declare(strict_types=1);

/**
 * CoinPayPortal webhook signature verifier for FOSSBilling.
 *
 * Contract (kept in lockstep with src/lib/webhooks/service.ts,
 * packages/sdk/src/webhooks.js, and the WooCommerce/WHMCS plugins):
 *
 *   Header:    X-CoinPay-Signature: t=<unix_seconds>,v1=<hex_hmac>
 *   HMAC body: "{timestamp}.{rawBody}"
 *   Algorithm: HMAC-SHA256
 *   Tolerance: 300 seconds
 *
 * This class previously expected `X-COINPAYPORTAL-SIGNATURE: sha256=<hmac>`
 * over the bare body — a format the server has never sent. Every legitimate
 * webhook therefore failed verification, and the only way to make the
 * integration work at all was to turn verification off, which is strictly
 * worse than no verification code: it looks protected and is not. The formats
 * now match, so a correctly configured plugin verifies real deliveries and
 * rejects forged ones.
 */
class WebhookVerifier
{
    public const HEADER_NAME = 'X-CoinPay-Signature';

    /** Max age, in seconds, between the signed-at timestamp and now. */
    public const DEFAULT_TOLERANCE = 300;

    /**
     * Verify a CoinPayPortal webhook signature.
     *
     * Returns false for any invalid, missing, malformed, or stale signature.
     *
     * @param string $rawBody   The exact raw request body (never re-encoded JSON).
     * @param string $signatureHeader Value of the X-CoinPay-Signature header.
     * @param string $secret    Merchant webhook secret.
     * @param int    $tolerance Max signature age in seconds.
     */
    public static function verify(
        string $rawBody,
        string $signatureHeader,
        string $secret,
        int $tolerance = self::DEFAULT_TOLERANCE
    ): bool {
        if ($rawBody === '' || $signatureHeader === '' || $secret === '') {
            return false;
        }

        $parts = [];
        foreach (explode(',', $signatureHeader) as $piece) {
            $kv = explode('=', $piece, 2);
            if (count($kv) === 2) {
                $parts[trim($kv[0])] = trim($kv[1]);
            }
        }

        if (!isset($parts['t'], $parts['v1'])) {
            return false;
        }

        $timestamp = (int) $parts['t'];
        $provided  = (string) $parts['v1'];

        if ($timestamp <= 0 || $provided === '') {
            return false;
        }

        // Reject stale signatures so a captured delivery cannot be replayed
        // indefinitely.
        if (abs(time() - $timestamp) > $tolerance) {
            return false;
        }

        // The timestamp is part of the signed material, so it cannot be edited
        // to defeat the freshness check without invalidating the HMAC.
        $expected = hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);

        return hash_equals($expected, $provided);
    }

    /**
     * Generate a signature header value. For tests and replay tooling.
     */
    public static function sign(string $rawBody, string $secret, ?int $timestamp = null): string
    {
        $ts  = $timestamp ?? time();
        $sig = hash_hmac('sha256', $ts . '.' . $rawBody, $secret);

        return 't=' . $ts . ',v1=' . $sig;
    }
}
