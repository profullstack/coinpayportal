<?php
/**
 * CoinPayPortal for PrestaShop — stub.
 *
 * Real PaymentModule subclass goes here:
 *   - install() / uninstall() with config keys
 *   - hookPaymentOptions() returning a PaymentOption that points at
 *     controllers/front/validation.php
 *   - getContent() admin form for API key / business id / webhook secret
 *
 * @package CoinPayPortal
 * @license MIT
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

class CoinPayPortal extends PaymentModule
{
    public function __construct()
    {
        $this->name = 'coinpayportal';
        $this->tab = 'payments_gateways';
        $this->version = '0.0.0';
        $this->author = 'Profullstack, Inc.';
        $this->bootstrap = true;
        parent::__construct();
        $this->displayName = 'CoinPayPortal — Crypto Payments';
        $this->description = 'Accept crypto payments via CoinPayPortal hosted checkout.';
    }

    public function install(): bool
    {
        // TODO: register hooks (paymentOptions, displayHeader), seed config.
        return parent::install();
    }
}
