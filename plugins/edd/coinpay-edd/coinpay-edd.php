<?php
/**
 * Plugin Name: CoinPay for Easy Digital Downloads
 * Plugin URI:  https://coinpayportal.com
 * Description: Stub. Adds CoinPayPortal as an EDD payment gateway. Not yet a working plugin.
 * Version:     0.0.0
 * Author:      Profullstack, Inc.
 * Author URI:  https://profullstack.com
 * License:     MIT
 * Text Domain: coinpay-edd
 * Requires PHP: 8.0
 * Requires at least: 6.0
 */

if (!defined('ABSPATH')) {
    exit;
}

// TODO:
//  - register gateway via 'edd_payment_gateways' filter
//  - settings via 'edd_settings_gateways'
//  - process via 'edd_gateway_<gateway-id>' action — build CoinPay hosted checkout and redirect
//  - webhook listener at admin-post.php?action=coinpay_edd_webhook
