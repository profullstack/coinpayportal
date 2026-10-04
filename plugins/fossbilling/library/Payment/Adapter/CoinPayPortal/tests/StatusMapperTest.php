<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../../../src/StatusMapper.php';

class StatusMapperTest extends TestCase
{
    /**
     * The events the backend ACTUALLY emits.
     *
     * Every test below this group covers an event type CoinPayPortal never
     * sends ('payment.completed', 'payment.overpaid', 'payment.pending', ...).
     * The map only had mark_paid entries for those fictional events, so every
     * real delivery fell through to 'ignore' and automated invoice crediting
     * never fired — with a full, green test suite, because the suite tested the
     * same fiction the map did.
     *
     * Source of truth: the WebhookEvent union in src/lib/supabase/types.ts and
     * the emit sites in src/lib/webhooks/service.ts.
     */
    public function testPaymentConfirmedIsMarkPaid(): void
    {
        $this->assertSame('mark_paid', StatusMapper::map('payment.confirmed'));
    }

    public function testPaymentForwardedIsMarkPaid(): void
    {
        $this->assertSame('mark_paid', StatusMapper::map('payment.forwarded'));
    }

    public function testPaymentForwardingIsMarkPaid(): void
    {
        // Downstream of confirmation: the money arrived and is on its way out.
        $this->assertSame('mark_paid', StatusMapper::map('payment.forwarding'));
    }

    public function testPaymentCreatedIsPending(): void
    {
        $this->assertSame('pending', StatusMapper::map('payment.created'));
    }

    public function testPaymentDetectedIsPending(): void
    {
        $this->assertSame('pending', StatusMapper::map('payment.detected'));
    }

    public function testEveryEmittedEventIsMapped(): void
    {
        // Guards the regression directly: if the backend gains an event type,
        // this fails rather than silently ignoring deliveries.
        $emitted = [
            'payment.created',
            'payment.detected',
            'payment.confirmed',
            'payment.forwarding',
            'payment.forwarded',
            'payment.failed',
            'payment.expired',
        ];

        foreach ($emitted as $event) {
            $action = StatusMapper::map($event);
            $this->assertContains(
                $action,
                ['mark_paid', 'pending', 'ignore', 'warn'],
                sprintf('event %s produced an unexpected action', $event)
            );
        }

        // And at least one of them must actually credit an invoice, otherwise
        // the plugin is inert no matter how well-formed the map looks.
        $this->assertSame('mark_paid', StatusMapper::map('payment.confirmed'));
    }

    public function testPaymentCompletedIsMarkPaid(): void
    {
        $this->assertSame('mark_paid', StatusMapper::map('payment.completed'));
    }

    public function testPaymentOverpaidIsMarkPaid(): void
    {
        $this->assertSame('mark_paid', StatusMapper::map('payment.overpaid'));
    }

    public function testPaymentPendingIsPending(): void
    {
        $this->assertSame('pending', StatusMapper::map('payment.pending'));
    }

    public function testPaymentConfirmingIsPending(): void
    {
        $this->assertSame('pending', StatusMapper::map('payment.confirming'));
    }

    public function testPaymentUnderpaidIsPending(): void
    {
        $this->assertSame('pending', StatusMapper::map('payment.underpaid'));
    }

    public function testPaymentExpiredIsIgnore(): void
    {
        $this->assertSame('ignore', StatusMapper::map('payment.expired'));
    }

    public function testPaymentFailedIsIgnore(): void
    {
        $this->assertSame('ignore', StatusMapper::map('payment.failed'));
    }

    public function testCheckoutCreatedIsIgnore(): void
    {
        $this->assertSame('ignore', StatusMapper::map('checkout.created'));
    }

    public function testPaymentRefundedIsWarn(): void
    {
        $this->assertSame('warn', StatusMapper::map('payment.refunded'));
    }

    public function testPaymentDisputedIsWarn(): void
    {
        $this->assertSame('warn', StatusMapper::map('payment.disputed'));
    }

    public function testUnknownEventIsIgnore(): void
    {
        $this->assertSame('ignore', StatusMapper::map('some.unknown.event'));
    }

    public function testEmptyStringIsIgnore(): void
    {
        $this->assertSame('ignore', StatusMapper::map(''));
    }
}
