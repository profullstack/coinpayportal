<?php

if (!defined('ABSPATH')) {
    exit;
}

use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

/**
 * Block-based checkout integration for CoinPay.
 *
 * WooCommerce 7.0+ ships the block checkout, which loads payment methods
 * via a React-based registry instead of the classic server-rendered
 * `payment_fields()` method. This class is the bridge between our
 * `WC_Gateway_CoinPay` class and that registry.
 *
 * Registered in the main plugin file behind the
 * `woocommerce_blocks_payment_method_type_registration` hook.
 */
final class WC_Gateway_CoinPay_Blocks_Support extends AbstractPaymentMethodType
{
    /** @var string */
    protected $name = WC_Gateway_CoinPay::ID;

    /** @var array */
    private $gateway_settings = [];

    public function initialize()
    {
        $this->settings = get_option('woocommerce_coinpay_settings', []);
        $this->gateway_settings = $this->settings;
    }

    public function is_active()
    {
        if (empty($this->settings['enabled']) || $this->settings['enabled'] !== 'yes') {
            return false;
        }
        if (empty($this->settings['api_key']) || empty($this->settings['business_id'])) {
            return false;
        }
        return true;
    }

    /**
     * Register and return the JS handle(s) used by the block checkout.
     * The script must call `registerPaymentMethod()` with a content
     * component — the browser then renders that component inside the
     * block checkout when CoinPay is selected.
     */
    public function get_payment_method_script_handles()
    {
        $handle = 'coinpay-blocks-integration';

        wp_register_script(
            $handle,
            COINPAY_WC_URL . 'assets/js/blocks/coinpay-blocks.js',
            [
                'wp-element',
                'wp-html-entities',
                'wp-i18n',
                'wc-blocks-registry',
                'wc-settings',
            ],
            COINPAY_WC_VERSION,
            true
        );

        if (function_exists('wp_set_script_translations')) {
            wp_set_script_translations($handle, 'coinpay-woocommerce');
        }

        return [$handle];
    }

    /**
     * Data handed to the JS script via `wc.wcSettings.getSetting('coinpay_data')`.
     * Kept minimal — the heavy lifting (creating the session, redirecting) all
     * happens server-side via the classic `process_payment()` path, which the
     * block checkout also calls for redirect-style gateways.
     */
    public function get_payment_method_data()
    {
        return [
            'title'       => $this->gateway_settings['title'] ?? __('CoinPay (crypto + card)', 'coinpay-woocommerce'),
            'description' => $this->gateway_settings['description'] ?? '',
            'icons'       => [],
            'supports'    => ['products', 'refunds'],
        ];
    }
}
