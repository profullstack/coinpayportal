<?php
namespace Opencart\Catalog\Controller\Extension\Coinpayportal\Payment;

/**
 * CoinPayPortal — OpenCart 4.x catalog-side payment controller (stub).
 *
 * Real index() returns the rendered "Pay with crypto" button + hidden form
 * pointing at confirm() which builds a CoinPay hosted checkout and redirects.
 */
class Coinpayportal extends \Opencart\System\Engine\Controller
{
    public function index(): string
    {
        return 'TODO: render payment template with hosted-checkout button.';
    }

    public function confirm(): void
    {
        // TODO: validate cart, build CoinPay checkout via packages/coinpay-php,
        // then redirect customer to the hosted checkout URL.
    }
}
