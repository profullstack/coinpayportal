<?php
/**
 * Plugin Name: CoinPay for WooCommerce
 * Plugin URI:  https://coinpayportal.com
 * Description: Accept cryptocurrency (BTC, ETH, SOL, POL, BCH, USDC) and credit card payments through CoinPay hosted checkout.
 * Version:     0.1.0
 * Author:      Profullstack, Inc.
 * Author URI:  https://profullstack.com
 * License:     MIT
 * Text Domain: coinpay-woocommerce
 * Requires PHP: 7.4
 * Requires at least: 6.0
 * WC requires at least: 7.0
 * WC tested up to: 9.5
 */

if (!defined('ABSPATH')) {
    exit;
}

define('COINPAY_WC_VERSION', '0.1.0');
define('COINPAY_WC_FILE', __FILE__);
define('COINPAY_WC_DIR', plugin_dir_path(__FILE__));
define('COINPAY_WC_URL', plugin_dir_url(__FILE__));

// Vendored shared PHP client (see packages/coinpay-php/).
require_once COINPAY_WC_DIR . 'lib/CoinPay/ApiException.php';
require_once COINPAY_WC_DIR . 'lib/CoinPay/Client.php';
require_once COINPAY_WC_DIR . 'lib/CoinPay/Webhook.php';
require_once COINPAY_WC_DIR . 'lib/CoinPay/StatusMap.php';

require_once COINPAY_WC_DIR . 'includes/class-coinpay-logger.php';
require_once COINPAY_WC_DIR . 'includes/class-coinpay-webhook-handler.php';

/**
 * Declare HPOS (High-Performance Order Storage) compatibility.
 */
add_action('before_woocommerce_init', function () {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
            'custom_order_tables',
            COINPAY_WC_FILE,
            true
        );
    }
});

/**
 * Register the gateway class with WooCommerce once WC has booted.
 */
add_action('plugins_loaded', function () {
    if (!class_exists('WC_Payment_Gateway')) {
        add_action('admin_notices', function () {
            echo '<div class="notice notice-error"><p>'
                . esc_html__('CoinPay for WooCommerce requires WooCommerce to be installed and active.', 'coinpay-woocommerce')
                . '</p></div>';
        });
        return;
    }

    require_once COINPAY_WC_DIR . 'includes/class-wc-gateway-coinpay.php';

    add_filter('woocommerce_payment_gateways', function ($methods) {
        $methods[] = 'WC_Gateway_CoinPay';
        return $methods;
    });

    add_filter('plugin_action_links_' . plugin_basename(COINPAY_WC_FILE), function ($links) {
        $settings_url = admin_url('admin.php?page=wc-settings&tab=checkout&section=coinpay');
        array_unshift($links, '<a href="' . esc_url($settings_url) . '">' . esc_html__('Settings', 'coinpay-woocommerce') . '</a>');
        return $links;
    });

    CoinPay_WC_Webhook_Handler::register();
}, 11);

/**
 * AJAX: admin-only "Test connection" handler.
 */
add_action('wp_ajax_coinpay_test_connection', function () {
    check_ajax_referer('coinpay_test_connection', 'nonce');

    if (!current_user_can('manage_woocommerce')) {
        wp_send_json_error(['message' => __('Insufficient permissions.', 'coinpay-woocommerce')], 403);
    }

    $settings = get_option('woocommerce_coinpay_settings', []);
    $api_key  = isset($settings['api_key']) ? trim((string) $settings['api_key']) : '';
    $base_url = isset($settings['api_base_url']) ? trim((string) $settings['api_base_url']) : \CoinPay\Client::DEFAULT_BASE_URL;

    if ($api_key === '') {
        wp_send_json_error(['message' => __('API key is not set. Save settings first.', 'coinpay-woocommerce')]);
    }

    try {
        $client = new \CoinPay\Client([
            'api_key'  => $api_key,
            'base_url' => $base_url,
        ]);
        $result = $client->ping();
        wp_send_json_success([
            'message'    => __('Connection successful.', 'coinpay-woocommerce'),
            'businesses' => isset($result['businesses']) && is_array($result['businesses']) ? count($result['businesses']) : null,
        ]);
    } catch (\CoinPay\ApiException $e) {
        wp_send_json_error(['message' => sprintf(
            /* translators: %1$d HTTP status, %2$s error message */
            __('CoinPay API returned %1$d: %2$s', 'coinpay-woocommerce'),
            $e->getHttpStatus(),
            $e->getMessage()
        )]);
    } catch (\Throwable $e) {
        wp_send_json_error(['message' => $e->getMessage()]);
    }
});
