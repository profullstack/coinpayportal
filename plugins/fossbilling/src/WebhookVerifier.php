<?php
declare(strict_types=1);

class WebhookVerifier
{
    /**
     * Verify a CoinPayPortal webhook signature.
     *
     * Expected header format: sha256=<hmac-hex>
     *
     * Returns false for any invalid/missing/malformed signature.
     * Only throws on a programming error (empty secret).
     */
    public static function verify(string $rawBody, string $signatureHeader, string $secret): bool
    {
        if ($secret === '') {
            return false;
        }

        if (!str_starts_with($signatureHeader, 'sha256=')) {
            return false;
        }

        $providedHash = substr($signatureHeader, 7);

        if ($providedHash === '') {
            return false;
        }

        $expectedHash = hash_hmac('sha256', $rawBody, $secret);

        return hash_equals($expectedHash, $providedHash);
    }
}
