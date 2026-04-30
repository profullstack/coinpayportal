<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../../../src/StatusMapper.php';

class StatusMapperTest extends TestCase
{
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
