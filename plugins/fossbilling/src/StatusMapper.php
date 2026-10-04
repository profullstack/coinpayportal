<?php
declare(strict_types=1);

class StatusMapper
{
    /**
     * CoinPayPortal event type -> FOSSBilling action.
     *
     * This map used to key on 'payment.completed' and 'payment.overpaid' for
     * mark_paid. The backend emits neither. What it actually emits, confirmed
     * against src/lib/webhooks/service.ts and the WebhookEvent union in
     * src/lib/supabase/types.ts, is:
     *
     *   payment.confirmed, payment.forwarded, payment.failed, payment.expired
     *   (with payment.created / payment.detected / payment.forwarding declared)
     *
     * None of the mark_paid keys were reachable, and map() falls back to
     * 'ignore', so every real webhook was discarded and automated invoice
     * crediting never fired — 100% of transactions, silently, because
     * "ignore" is also the correct answer for events we genuinely do not act on.
     *
     * The legacy keys are retained: they cost nothing, and an older backend or a
     * replayed historical delivery may still carry them.
     */
    private const MAP = [
        // Funds confirmed on-chain. This is the event that credits an invoice.
        'payment.confirmed'  => 'mark_paid',
        // Downstream of confirmation — the money arrived and is now on its way
        // to the merchant. Still paid, and crediting is idempotent.
        'payment.forwarding' => 'mark_paid',
        'payment.forwarded'  => 'mark_paid',

        // Legacy / not currently emitted, kept for compatibility.
        'payment.completed'  => 'mark_paid',
        'payment.overpaid'   => 'mark_paid',

        // Seen, but not yet money.
        'payment.created'    => 'pending',
        'payment.detected'   => 'pending',
        'payment.pending'    => 'pending',
        'payment.confirming' => 'pending',
        'payment.underpaid'  => 'pending',

        // Terminal, nothing to do.
        'payment.expired'    => 'ignore',
        'payment.failed'     => 'ignore',
        'checkout.created'   => 'ignore',

        // Needs a human.
        'payment.refunded'   => 'warn',
        'payment.disputed'   => 'warn',
    ];

    /**
     * Map a CoinPayPortal event type to a FOSSBilling action.
     *
     * @return 'mark_paid'|'pending'|'ignore'|'warn'
     */
    public static function map(string $eventType): string
    {
        if (!isset(self::MAP[$eventType])) {
            // Unknown events are still ignored — a plugin must not act on an
            // event it does not understand — but no longer silently. An
            // unrecognised event type is how this class came to drop every
            // delivery it received without anyone noticing.
            error_log(sprintf(
                'CoinPayPortal: unmapped webhook event type "%s" — ignoring',
                $eventType
            ));
            return 'ignore';
        }

        return self::MAP[$eventType];
    }
}
