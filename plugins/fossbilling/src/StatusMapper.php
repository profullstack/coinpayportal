<?php
declare(strict_types=1);

class StatusMapper
{
    private const MAP = [
        'payment.completed'  => 'mark_paid',
        'payment.overpaid'   => 'mark_paid',
        'payment.pending'    => 'pending',
        'payment.confirming' => 'pending',
        'payment.underpaid'  => 'pending',
        'payment.expired'    => 'ignore',
        'payment.failed'     => 'ignore',
        'payment.refunded'   => 'warn',
        'payment.disputed'   => 'warn',
        'checkout.created'   => 'ignore',
    ];

    /**
     * Map a CoinPayPortal event type to a FOSSBilling action.
     *
     * @return 'mark_paid'|'pending'|'ignore'|'warn'
     */
    public static function map(string $eventType): string
    {
        return self::MAP[$eventType] ?? 'ignore';
    }
}
