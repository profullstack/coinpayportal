<?php

namespace CoinPay;

/**
 * CoinPay webhook signature verifier.
 *
 * Contract (kept in lockstep with packages/sdk/src/webhooks.js):
 *   Header:    X-CoinPay-Signature: t=<unix_seconds>,v1=<hex_hmac>
 *   HMAC body: "{timestamp}.{rawBody}"
 *   Algorithm: HMAC-SHA256
 *   Tolerance: 300 seconds (configurable)
 */
class Webhook
{
    public const HEADER_NAME = 'X-CoinPay-Signature';
    public const DEFAULT_TOLERANCE = 300;

    public const EVENT_PAYMENT_CREATED    = 'payment.created';
    public const EVENT_PAYMENT_PENDING    = 'payment.pending';
    public const EVENT_PAYMENT_CONFIRMING = 'payment.confirming';
    public const EVENT_PAYMENT_COMPLETED  = 'payment.completed';
    public const EVENT_PAYMENT_EXPIRED    = 'payment.expired';
    public const EVENT_PAYMENT_FAILED     = 'payment.failed';
    public const EVENT_PAYMENT_REFUNDED   = 'payment.refunded';

    /**
     * Verify an incoming webhook signature.
     *
     * @param string $rawBody   The exact raw request body (no JSON re-encoding).
     * @param string $signature Value of the X-CoinPay-Signature header.
     * @param string $secret    Merchant webhook secret.
     * @param int    $tolerance Max age in seconds between signed-at and now.
     */
    public static function verify(string $rawBody, string $signature, string $secret, int $tolerance = self::DEFAULT_TOLERANCE): bool
    {
        if ($rawBody === '' || $signature === '' || $secret === '') {
            return false;
        }

        $parts = [];
        foreach (explode(',', $signature) as $piece) {
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

        $age = abs(time() - $timestamp);
        if ($age > $tolerance) {
            return false;
        }

        $expected = hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);

        return hash_equals($expected, $provided);
    }

    /**
     * Generate a signature header value (for tests or replay tooling).
     */
    public static function sign(string $rawBody, string $secret, ?int $timestamp = null): string
    {
        $ts  = $timestamp ?? time();
        $sig = hash_hmac('sha256', $ts . '.' . $rawBody, $secret);
        return 't=' . $ts . ',v1=' . $sig;
    }

    /**
     * Parse a JSON webhook body into a normalized event array.
     *
     * @return array{id:?string,type:?string,data:array,business_id:?string,created_at:?string}
     */
    public static function parse(string $rawBody): array
    {
        $decoded = json_decode($rawBody, true);
        if (!is_array($decoded)) {
            throw new \InvalidArgumentException('Invalid webhook JSON');
        }

        return [
            'id'          => isset($decoded['id']) ? (string) $decoded['id'] : null,
            'type'        => isset($decoded['type']) ? (string) $decoded['type'] : null,
            'data'        => isset($decoded['data']) && is_array($decoded['data']) ? $decoded['data'] : [],
            'business_id' => isset($decoded['business_id']) ? (string) $decoded['business_id'] : null,
            'created_at'  => isset($decoded['created_at']) ? (string) $decoded['created_at'] : null,
        ];
    }
}
