<?php
/**
 * Uninstall cleanup for CoinPay for WooCommerce.
 *
 * Only fires when the user deletes the plugin (not on deactivate).
 * We deliberately keep order meta intact — those records matter for
 * accounting even after the plugin is removed.
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

delete_option('woocommerce_coinpay_settings');
