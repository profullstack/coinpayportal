<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../src/CoinPayPortalClient.php';
require_once __DIR__ . '/../../../src/WebhookVerifier.php';
require_once __DIR__ . '/../../../src/StatusMapper.php';

/**
 * CoinPayPortal payment gateway adapter for FOSSBilling.
 *
 * Install at: /library/Payment/Adapter/CoinPayPortal.php
 */
class Payment_Adapter_CoinPayPortal
{
    private array $config;

    public function __construct(array $config)
    {
        $this->config = $config;
    }

    // ─── Gateway metadata ────────────────────────────────────────────────────

    public static function getConfig(): array
    {
        return [
            'supports_one_time_payments' => true,
            'supports_subscriptions'     => false,
            'description'                => 'Accept crypto payments through CoinPayPortal. Customers are redirected to a secure CoinPayPortal checkout page and invoices are automatically marked paid after verified payment confirmation.',
            'logo'                       => [
                'logo'   => 'CoinPayPortal/icon.svg',
                'height' => '50px',
                'width'  => '100px',
            ],
            'form' => [
                'api_key' => [
                    'label'       => 'API Key',
                    'type'        => 'password',
                    'required'    => true,
                    'description' => 'Your CoinPayPortal API key. Found in your merchant dashboard under Settings → API.',
                ],
                'merchant_id' => [
                    'label'       => 'Merchant ID',
                    'type'        => 'text',
                    'required'    => true,
                    'description' => 'Your CoinPayPortal merchant or account ID.',
                ],
                'webhook_secret' => [
                    'label'       => 'Webhook Secret',
                    'type'        => 'password',
                    'required'    => true,
                    'description' => 'Secret used to verify incoming webhook signatures from CoinPayPortal.',
                ],
                'api_url' => [
                    'label'       => 'API Base URL',
                    'type'        => 'text',
                    'required'    => false,
                    'default'     => 'https://api.coinpayportal.com',
                    'description' => 'CoinPayPortal API base URL. Do not change unless instructed.',
                ],
                'sandbox' => [
                    'label'       => 'Sandbox Mode',
                    'type'        => 'select',
                    'required'    => false,
                    'default'     => 'no',
                    'options'     => ['no' => 'No (live)', 'yes' => 'Yes (sandbox/test)'],
                    'description' => 'Enable sandbox mode to test payments without using live funds.',
                ],
                'sandbox_api_url' => [
                    'label'       => 'Sandbox API Base URL',
                    'type'        => 'text',
                    'required'    => false,
                    'default'     => 'https://sandbox-api.coinpayportal.com',
                    'description' => 'API base URL used when sandbox mode is enabled.',
                ],
                'display_name' => [
                    'label'       => 'Display Name',
                    'type'        => 'text',
                    'required'    => false,
                    'default'     => 'CoinPayPortal Crypto Payments',
                    'description' => 'Payment method name shown to customers.',
                ],
                'expiration_minutes' => [
                    'label'       => 'Payment Expiration (minutes)',
                    'type'        => 'text',
                    'required'    => false,
                    'default'     => '30',
                    'description' => 'How many minutes before a crypto checkout session expires.',
                ],
                'debug_logging' => [
                    'label'       => 'Debug Logging',
                    'type'        => 'select',
                    'required'    => false,
                    'default'     => 'no',
                    'options'     => ['no' => 'No', 'yes' => 'Yes'],
                    'description' => 'Enable verbose logging for troubleshooting. Disable in production.',
                ],
                'underpayment_tolerance' => [
                    'label'       => 'Underpayment Tolerance (%)',
                    'type'        => 'text',
                    'required'    => false,
                    'default'     => '0',
                    'description' => 'Percentage of invoice total by which an underpayment is still accepted (e.g. 2 = accept if paid ≥98%). Set to 0 to require exact amount.',
                ],
            ],
        ];
    }

    // ─── Payment button HTML ─────────────────────────────────────────────────

    public function getHtml($api_admin, $invoice, $display, $attempts): string
    {
        $isSandbox  = ($this->config['sandbox'] ?? 'no') === 'yes';
        $baseUrl    = $isSandbox
            ? ($this->config['sandbox_api_url'] ?? 'https://sandbox-api.coinpayportal.com')
            : ($this->config['api_url'] ?? 'https://api.coinpayportal.com');
        $apiKey      = $this->config['api_key'] ?? '';
        $merchantId  = $this->config['merchant_id'] ?? '';
        $displayName = $this->config['display_name'] ?? 'CoinPayPortal Crypto Payments';
        $expMinutes  = (int)($this->config['expiration_minutes'] ?? 30);
        $debug       = ($this->config['debug_logging'] ?? 'no') === 'yes';

        $invoiceId   = $invoice['id'] ?? '';
        $serieNr     = $invoice['serie_nr'] ?? (string)$invoiceId;
        $total       = $invoice['total'] ?? '0.00';
        $currency    = $invoice['currency'] ?? 'USD';
        $buyerEmail  = $invoice['buyer']['email'] ?? '';
        $buyerFirst  = $invoice['buyer']['first_name'] ?? '';
        $buyerLast   = $invoice['buyer']['last_name'] ?? '';
        $buyerId     = $invoice['buyer']['id'] ?? '';

        $returnUrl  = bb_url('client/invoice/' . $invoiceId);
        $successUrl = $returnUrl . '?coinpayportal=success';
        $cancelUrl  = $returnUrl . '?coinpayportal=cancel';
        $webhookUrl = bb_url('ipn/CoinPayPortal');

        try {
            $client = new CoinPayPortalClient(
                $baseUrl,
                $apiKey,
                $debug,
                $debug ? [$this, 'log'] : null
            );

            $payload = [
                'merchant_id' => $merchantId,
                'invoice_id'  => $serieNr,
                'amount'      => (string)$total,
                'currency'    => $currency,
                'description' => 'FOSSBilling Invoice #' . $serieNr,
                'expires_in'  => $expMinutes * 60,
                'customer'    => [
                    'id'    => (string)$buyerId,
                    'email' => $buyerEmail,
                    'name'  => trim($buyerFirst . ' ' . $buyerLast),
                ],
                'metadata' => [
                    'platform'               => 'fossbilling',
                    'fossbilling_invoice_id' => (string)$invoiceId,
                    'fossbilling_client_id'  => (string)$buyerId,
                ],
                'return_url'  => $returnUrl,
                'success_url' => $successUrl,
                'cancel_url'  => $cancelUrl,
                'webhook_url' => $webhookUrl,
            ];

            $checkout    = $client->createCheckout($payload);
            $checkoutUrl = $checkout['checkout_url'] ?? $checkout['url'] ?? '';
            $checkoutId  = $checkout['id'] ?? $checkout['checkout_id'] ?? '';

            if ($checkoutUrl === '') {
                throw new RuntimeException('CoinPayPortal did not return a checkout URL.');
            }

            if ($checkoutId !== '') {
                $_SESSION['coinpayportal_checkout_' . $invoiceId] = $checkoutId;
            }

            $this->log(sprintf(
                'Created checkout %s for invoice %s amount %s %s',
                $checkoutId,
                $invoiceId,
                $total,
                $currency
            ));

        } catch (\Throwable $e) {
            $this->log('ERROR creating checkout: ' . $e->getMessage());
            $errorMessage = 'We could not start the crypto checkout. Please contact support or try again.';
            return $this->renderTemplate('error', ['error_message' => $errorMessage]);
        }

        return $this->renderTemplate('pay', [
            'invoice'      => $invoice,
            'checkout_url' => $checkoutUrl,
            'display_name' => $displayName,
        ]);
    }

    // ─── Webhook / IPN handler ───────────────────────────────────────────────

    public function processTransaction($api_admin, $id, $data, $gateway_id): void
    {
        $rawBody  = file_get_contents('php://input');
        $sigHeader = $_SERVER['HTTP_X_COINPAYPORTAL_SIGNATURE'] ?? '';
        $secret    = $this->config['webhook_secret'] ?? '';

        if (!WebhookVerifier::verify((string)$rawBody, $sigHeader, $secret)) {
            $this->log('Webhook signature verification failed');
            http_response_code(401);
            exit;
        }

        $event = json_decode((string)$rawBody, true);

        if (!is_array($event)) {
            $this->log('Webhook received invalid JSON');
            http_response_code(400);
            exit;
        }

        $eventId   = $event['id'] ?? '';
        $eventType = $event['type'] ?? '';
        $eventData = $event['data'] ?? [];

        $this->log(sprintf('Webhook received event=%s id=%s', $eventType, $eventId));

        $invoiceId = $eventData['metadata']['fossbilling_invoice_id']
            ?? $eventData['invoice_id']
            ?? null;

        if (!$invoiceId) {
            $this->log('Webhook missing fossbilling_invoice_id, ignoring');
            http_response_code(200);
            return;
        }

        try {
            $invoice = $api_admin->invoice->get(['id' => (int)$invoiceId]);
        } catch (\Throwable $e) {
            $this->log('Could not find invoice ' . $invoiceId . ': ' . $e->getMessage());
            http_response_code(200);
            return;
        }

        if (($invoice['status'] ?? '') === 'paid') {
            $this->log(sprintf('Invoice %s already paid, ignoring event %s', $invoiceId, $eventId));
            http_response_code(200);
            return;
        }

        $action = StatusMapper::map($eventType);

        $this->log(sprintf('Event type=%s mapped to action=%s for invoice=%s', $eventType, $action, $invoiceId));

        if ($action === 'mark_paid') {
            $paidAmount  = (float)($eventData['amount'] ?? 0);
            $invoiceTotal = (float)($invoice['total'] ?? 0);
            $tolerance   = (float)($this->config['underpayment_tolerance'] ?? 0);
            $minAccepted = $invoiceTotal * (1 - $tolerance / 100);

            if ($paidAmount < $minAccepted) {
                $this->log(sprintf(
                    'Underpayment on invoice %s: received %.2f, required %.2f (tolerance %.1f%%)',
                    $invoiceId,
                    $paidAmount,
                    $invoiceTotal,
                    $tolerance
                ));
                http_response_code(200);
                return;
            }

            $paymentId = $eventData['payment_id'] ?? $eventData['id'] ?? $eventId;
            $txHash    = $eventData['txid'] ?? '';
            $paidAsset = $eventData['paid_asset'] ?? '';
            $paidCrypto = $eventData['paid_amount'] ?? '';

            try {
                $api_admin->invoice->transaction_create([
                    'invoice_id' => (int)$invoiceId,
                    'txid'       => $paymentId,
                    'gateway_id' => $gateway_id,
                    'amount'     => $paidAmount,
                    'currency'   => $eventData['currency'] ?? $invoice['currency'] ?? 'USD',
                    'type'       => 'coinpayportal',
                    'note'       => sprintf(
                        'CoinPayPortal payment %s%s%s',
                        $paymentId,
                        $txHash ? ' tx:' . $txHash : '',
                        $paidCrypto ? ' ' . $paidCrypto . ' ' . $paidAsset : ''
                    ),
                ]);

                $api_admin->invoice->mark_as_paid(['id' => (int)$invoiceId]);

                $this->log(sprintf(
                    'Marked invoice %s paid via CoinPayPortal payment %s',
                    $invoiceId,
                    $paymentId
                ));
            } catch (\Throwable $e) {
                $this->log('ERROR marking invoice paid: ' . $e->getMessage());
                http_response_code(500);
                return;
            }
        }

        http_response_code(200);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private function renderTemplate(string $name, array $vars = []): string
    {
        $tpl = __DIR__ . '/CoinPayPortal/templates/' . $name . '.phtml';

        if (!file_exists($tpl)) {
            return '<p>Template not found: ' . htmlspecialchars($name) . '</p>';
        }

        extract($vars, EXTR_SKIP);
        ob_start();
        include $tpl;
        return (string)ob_get_clean();
    }

    public function log(string $message, array $context = []): void
    {
        if (($this->config['debug_logging'] ?? 'no') !== 'yes') {
            return;
        }

        $line = '[CoinPayPortal] ' . $message;

        if (!empty($context)) {
            $safe = array_map(static function ($v) {
                $s = (string)$v;
                return strlen($s) > 8 ? '***' : $s;
            }, $context);
            $line .= ' ' . json_encode($safe);
        }

        error_log($line);
    }
}
