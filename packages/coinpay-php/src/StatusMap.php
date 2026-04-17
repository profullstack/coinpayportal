<?php

namespace CoinPay;

/**
 * Canonical CoinPay payment/webhook status codes plus platform-neutral
 * classification helpers. Plugins map these classes to their own order/invoice
 * states (WooCommerce, WHMCS, etc.) so the mapping logic lives in one place.
 */
class StatusMap
{
    // Canonical payment status strings emitted by the CoinPay API & webhooks.
    public const PENDING    = 'pending';
    public const CONFIRMING = 'confirming';
    public const CONFIRMED  = 'confirmed';
    public const COMPLETED  = 'completed';
    public const FORWARDED  = 'forwarded';
    public const EXPIRED    = 'expired';
    public const FAILED     = 'failed';
    public const CANCELLED  = 'cancelled';
    public const REFUNDED   = 'refunded';

    public const CLASS_PENDING  = 'pending';
    public const CLASS_PAID     = 'paid';
    public const CLASS_FAILED   = 'failed';
    public const CLASS_EXPIRED  = 'expired';
    public const CLASS_REFUNDED = 'refunded';
    public const CLASS_UNKNOWN  = 'unknown';

    /**
     * Classify a raw status into a platform-neutral bucket.
     */
    public static function classify(?string $status): string
    {
        switch (strtolower((string) $status)) {
            case self::PENDING:
            case self::CONFIRMING:
                return self::CLASS_PENDING;

            case self::CONFIRMED:
            case self::COMPLETED:
            case self::FORWARDED:
                return self::CLASS_PAID;

            case self::FAILED:
            case self::CANCELLED:
                return self::CLASS_FAILED;

            case self::EXPIRED:
                return self::CLASS_EXPIRED;

            case self::REFUNDED:
                return self::CLASS_REFUNDED;

            default:
                return self::CLASS_UNKNOWN;
        }
    }

    /**
     * Classify by webhook event type. Falls back to data.status if the event
     * name doesn't map cleanly.
     */
    public static function classifyEvent(?string $eventType, ?string $fallbackStatus = null): string
    {
        switch ((string) $eventType) {
            case Webhook::EVENT_PAYMENT_CREATED:
            case Webhook::EVENT_PAYMENT_PENDING:
            case Webhook::EVENT_PAYMENT_CONFIRMING:
                return self::CLASS_PENDING;

            case Webhook::EVENT_PAYMENT_COMPLETED:
                return self::CLASS_PAID;

            case Webhook::EVENT_PAYMENT_EXPIRED:
                return self::CLASS_EXPIRED;

            case Webhook::EVENT_PAYMENT_FAILED:
                return self::CLASS_FAILED;

            case Webhook::EVENT_PAYMENT_REFUNDED:
                return self::CLASS_REFUNDED;

            default:
                return self::classify($fallbackStatus);
        }
    }
}
