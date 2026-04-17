<?php
/**
 * CoinPay Payment Gateway for WHMCS.
 *
 * Register in WHMCS:
 *   Setup → Payments → Payment Gateways → All Payment Gateways → CoinPay.
 *
 * File layout (required by WHMCS module loader):
 *   modules/gateways/coinpay.php              ← this file (module entrypoint)
 *   modules/gateways/coinpay/lib/CoinPay/...  ← shared PHP client (vendored)
 *   modules/gateways/callback/coinpay.php     ← webhook receiver
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/coinpay/lib/CoinPay/ApiException.php';
require_once __DIR__ . '/coinpay/lib/CoinPay/Client.php';
require_once __DIR__ . '/coinpay/lib/CoinPay/Webhook.php';
require_once __DIR__ . '/coinpay/lib/CoinPay/StatusMap.php';

use CoinPay\Client as CoinPayClient;
use CoinPay\ApiException as CoinPayApiException;

/**
 * Module metadata.
 *
 * @return array
 */
function coinpay_MetaData()
{
    return [
        'DisplayName'                => 'CoinPay (crypto + card)',
        'APIVersion'                 => '1.1',
        'DisableLocalCreditCardInput'=> true,
        'TokenisedStorage'           => false,
    ];
}

/**
 * Admin-configurable settings.
 *
 * @return array
 */
function coinpay_config()
{
    $systemUrl = rtrim((string) \WHMCS\Config\Setting::getValue('SystemURL'), '/');
    $callback  = $systemUrl !== '' ? $systemUrl . '/modules/gateways/callback/coinpay.php' : '/modules/gateways/callback/coinpay.php';

    return [
        'FriendlyName' => [
            'Type'  => 'System',
            'Value' => 'CoinPay',
        ],
        'apiBaseUrl' => [
            'FriendlyName' => 'API base URL',
            'Type'         => 'text',
            'Size'         => '60',
            'Default'      => CoinPayClient::DEFAULT_BASE_URL,
            'Description'  => 'Override only if instructed by CoinPay support.',
        ],
        'apiKey' => [
            'FriendlyName' => 'API key',
            'Type'         => 'password',
            'Size'         => '60',
            'Description'  => 'From your CoinPay dashboard → Settings → API keys.',
        ],
        'businessId' => [
            'FriendlyName' => 'Business ID',
            'Type'         => 'text',
            'Size'         => '40',
            'Description'  => 'The CoinPay business that should receive payments.',
        ],
        'webhookSecret' => [
            'FriendlyName' => 'Webhook secret',
            'Type'         => 'password',
            'Size'         => '60',
            'Description'  => 'Paste the webhook URL below into CoinPay → Webhooks, then paste the signing secret here: <code>' . htmlspecialchars($callback, ENT_QUOTES) . '</code>',
        ],
        'environment' => [
            'FriendlyName' => 'Environment',
            'Type'         => 'dropdown',
            'Options'      => 'production,sandbox',
            'Default'      => 'production',
        ],
        'paymentMode' => [
            'FriendlyName' => 'Accepted payment methods',
            'Type'         => 'dropdown',
            'Options'      => 'both,crypto,card',
            'Default'      => 'both',
            'Description'  => 'Choose what CoinPay checkout offers buyers.',
        ],
        'cryptoChain' => [
            'FriendlyName' => 'Default crypto chain',
            'Type'         => 'dropdown',
            'Options'      => 'BTC,ETH,SOL,POL,BCH,USDC_ETH,USDC_POL,USDC_SOL,USDC_BASE',
            'Default'      => 'BTC',
            'Description'  => 'Which chain to request when crypto mode is selected.',
        ],
        'debugLogging' => [
            'FriendlyName' => 'Debug logging',
            'Type'         => 'yesno',
            'Default'      => 'no',
            'Description'  => 'Write verbose logs to Utilities → Logs → Gateway Log.',
        ],
    ];
}

/**
 * Log a gateway event. WHMCS stores these under Utilities → Logs → Gateway Log.
 *
 * @param string       $moduleName
 * @param array|string $request
 * @param array|string $response
 * @param array|string $replace
 */
function coinpay_log($moduleName, $request, $response, $replace = [])
{
    if (function_exists('logModuleCall')) {
        logModuleCall($moduleName, 'gateway', $request, $response, '', $replace);
    }
}

/**
 * Payment link builder — invoked by WHMCS when rendering an unpaid invoice.
 *
 * We eagerly call CoinPay, generate a hosted checkout URL, and render a
 * "Pay with CoinPay" button that links straight to it. A pending payment is
 * cached on the invoice (in tblinvoices.notes) to avoid creating a fresh
 * session on every page load.
 *
 * @param array $params
 * @return string Rendered HTML form/button.
 */
function coinpay_link($params)
{
    $apiKey        = trim((string) ($params['apiKey'] ?? ''));
    $apiBaseUrl    = trim((string) ($params['apiBaseUrl'] ?? CoinPayClient::DEFAULT_BASE_URL));
    $businessId    = trim((string) ($params['businessId'] ?? ''));
    $paymentMode   = (string) ($params['paymentMode'] ?? 'both');
    $cryptoChain   = (string) ($params['cryptoChain'] ?? 'BTC');

    $invoiceId   = (int) ($params['invoiceid'] ?? 0);
    $amount      = (float) ($params['amount'] ?? 0);
    $currency    = strtoupper((string) ($params['currency'] ?? 'USD'));
    $description = sprintf('%s Invoice #%d', $params['companyname'] ?? 'WHMCS', $invoiceId);

    $systemUrl   = rtrim((string) ($params['systemurl'] ?? ''), '/');
    $returnUrl   = $systemUrl . '/viewinvoice.php?id=' . $invoiceId;
    $cancelUrl   = $returnUrl;

    if ($apiKey === '' || $businessId === '') {
        return '<p style="color:#b00">CoinPay is not configured. Please contact the administrator.</p>';
    }

    $metadata = [
        'platform'       => 'whmcs',
        'plugin_version' => '0.1.0',
        'system_url'     => $systemUrl,
        'invoice_id'     => (string) $invoiceId,
        'client_id'      => (string) ($params['clientdetails']['id'] ?? $params['userid'] ?? ''),
        'customer_email' => (string) ($params['clientdetails']['email'] ?? ''),
        'customer_name'  => trim(($params['clientdetails']['firstname'] ?? '') . ' ' . ($params['clientdetails']['lastname'] ?? '')),
        'return_url'     => $returnUrl,
        'cancel_url'     => $cancelUrl,
    ];

    $client = new CoinPayClient([
        'api_key'  => $apiKey,
        'base_url' => $apiBaseUrl,
    ]);

    try {
        if (in_array($paymentMode, ['card', 'both'], true)) {
            $response = $client->createCardPayment([
                'business_id' => $businessId,
                'amount'      => (int) round($amount * 100),
                'currency'    => strtolower($currency),
                'description' => $description,
                'metadata'    => $metadata,
                'success_url' => $returnUrl,
                'cancel_url'  => $cancelUrl,
            ]);
        } else {
            $response = $client->createCryptoPayment([
                'business_id' => $businessId,
                'amount'      => $amount,
                'currency'    => $currency,
                'blockchain'  => $cryptoChain,
                'description' => $description,
                'metadata'    => $metadata,
            ]);
        }
    } catch (CoinPayApiException $e) {
        coinpay_log('CoinPay', [
            'action'     => 'create_payment',
            'invoice_id' => $invoiceId,
            'mode'       => $paymentMode,
        ], [
            'status'  => $e->getHttpStatus(),
            'message' => $e->getMessage(),
        ], [$apiKey]);

        return '<p style="color:#b00">Could not create CoinPay payment session. Please try again.</p>';
    } catch (\Throwable $e) {
        coinpay_log('CoinPay', [
            'action'     => 'create_payment',
            'invoice_id' => $invoiceId,
        ], [
            'error' => $e->getMessage(),
        ], [$apiKey]);

        return '<p style="color:#b00">Could not create CoinPay payment session. Please try again.</p>';
    }

    $payment     = isset($response['payment']) && is_array($response['payment']) ? $response['payment'] : $response;
    $paymentId   = $payment['id'] ?? $payment['payment_id'] ?? $response['id'] ?? null;
    $checkoutUrl = $payment['checkout_url']
        ?? $payment['hosted_checkout_url']
        ?? $response['checkout_url']
        ?? $response['hosted_checkout_url']
        ?? null;

    if (!$checkoutUrl || !filter_var($checkoutUrl, FILTER_VALIDATE_URL)) {
        coinpay_log('CoinPay', ['action' => 'create_payment', 'invoice_id' => $invoiceId], $response, [$apiKey]);
        return '<p style="color:#b00">CoinPay did not return a checkout URL. Please contact the administrator.</p>';
    }

    coinpay_log('CoinPay', [
        'action'     => 'create_payment',
        'invoice_id' => $invoiceId,
        'mode'       => $paymentMode,
    ], [
        'payment_id'   => $paymentId,
        'checkout_url' => $checkoutUrl,
    ], [$apiKey]);

    return '<form method="get" action="' . htmlspecialchars($checkoutUrl, ENT_QUOTES) . '">'
         . '<button type="submit" style="padding:10px 18px;font-size:14px;cursor:pointer;">Pay with CoinPay</button>'
         . '</form>';
}

/**
 * CoinPay currently requires admin-initiated refunds via the dashboard for
 * most rails. Expose a hook that annotates the invoice so WHMCS merchants
 * understand the workflow.
 *
 * @param array $params
 * @return array
 */
function coinpay_refund($params)
{
    return [
        'status'  => 'declined',
        'rawdata' => 'Refunds must currently be initiated from the CoinPay dashboard. A refund webhook will automatically update this invoice in WHMCS.',
    ];
}
