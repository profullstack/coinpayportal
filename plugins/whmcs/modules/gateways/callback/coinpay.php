<?php
/**
 * CoinPay webhook callback for WHMCS.
 *
 * Endpoint: https://<your-whmcs>/modules/gateways/callback/coinpay.php
 *
 * Verifies the HMAC signature, resolves the invoice via metadata, and applies
 * the event using WHMCS's standard gateway helpers.
 */

require_once __DIR__ . '/../../../init.php';

// WHMCS provides these; fall back to no-ops if loaded out of WHMCS context
// (useful for unit smoke tests).
if (function_exists('App::load_function')) {
    App::load_function('gateway');
    App::load_function('invoice');
}

require_once __DIR__ . '/../coinpay/lib/CoinPay/ApiException.php';
require_once __DIR__ . '/../coinpay/lib/CoinPay/Webhook.php';
require_once __DIR__ . '/../coinpay/lib/CoinPay/StatusMap.php';

use CoinPay\Webhook;
use CoinPay\StatusMap;

$moduleName = 'coinpay';
$gatewayParams = getGatewayVariables($moduleName);

if (empty($gatewayParams['type'])) {
    http_response_code(404);
    echo json_encode(['error' => 'gateway not configured']);
    exit;
}

$secret = (string) ($gatewayParams['webhookSecret'] ?? '');
$raw    = file_get_contents('php://input') ?: '';
$sig    = (string) ($_SERVER['HTTP_X_COINPAY_SIGNATURE'] ?? '');

if ($secret === '' || $raw === '' || $sig === '' || !Webhook::verify($raw, $sig, $secret)) {
    logModuleCall($moduleName, 'webhook.rejected', [
        'has_secret' => $secret !== '',
        'has_body'   => $raw !== '',
        'has_sig'    => $sig !== '',
    ], 'invalid signature', '', [$secret]);
    http_response_code(401);
    echo json_encode(['error' => 'invalid signature']);
    exit;
}

try {
    $event = Webhook::parse($raw);
} catch (\Throwable $e) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid json']);
    exit;
}

$eventId   = $event['id'];
$eventType = $event['type'];
$data      = $event['data'];
$payment   = isset($data['payment']) && is_array($data['payment']) ? $data['payment'] : $data;

$paymentId = $payment['id']
    ?? $payment['payment_id']
    ?? $data['payment_id']
    ?? null;

$metadata = array_merge(
    is_array($payment['metadata'] ?? null) ? $payment['metadata'] : [],
    is_array($data['metadata'] ?? null)    ? $data['metadata']    : []
);

$invoiceId = isset($metadata['invoice_id']) ? (int) $metadata['invoice_id'] : 0;
if ($invoiceId <= 0) {
    logModuleCall($moduleName, 'webhook.unmatched', $event, 'no invoice_id in metadata');
    http_response_code(200);
    echo json_encode(['received' => true, 'matched' => false]);
    exit;
}

// Validate invoice exists + map to a canonical id via WHMCS helper.
$resolvedId = checkCbInvoiceID($invoiceId, $moduleName);

// Idempotency: drop duplicate deliveries of the same event id.
if ($eventId) {
    $alreadySeen = checkCbTransID($eventId);
    if ($alreadySeen === false) {
        logModuleCall($moduleName, 'webhook.duplicate', ['event_id' => $eventId], 'already processed');
        http_response_code(200);
        echo json_encode(['received' => true, 'duplicate' => true]);
        exit;
    }
}

$rawStatus = isset($payment['status']) ? (string) $payment['status'] : null;
$class     = StatusMap::classifyEvent($eventType, $rawStatus);

$amount   = isset($payment['amount']) ? (float) $payment['amount'] : (float) ($data['amount'] ?? 0);
$currency = (string) ($payment['currency'] ?? $data['currency'] ?? '');

switch ($class) {
    case StatusMap::CLASS_PAID:
        // The CoinPay response carries no fee by default; fee = 0 unless the
        // merchant dashboard later exposes one. WHMCS addInvoicePayment is
        // idempotent by transid so this is safe on replays.
        addInvoicePayment(
            $resolvedId,
            $eventId ?: ($paymentId ?: uniqid('coinpay_', true)),
            $amount,
            0.0,
            $moduleName
        );
        logTransaction($moduleName, $event, 'Paid — ' . (string) $eventType);
        break;

    case StatusMap::CLASS_PENDING:
        logTransaction($moduleName, $event, 'Pending — ' . (string) $eventType);
        break;

    case StatusMap::CLASS_FAILED:
        logTransaction($moduleName, $event, 'Failed — ' . (string) $eventType);
        break;

    case StatusMap::CLASS_EXPIRED:
        logTransaction($moduleName, $event, 'Expired — ' . (string) $eventType);
        break;

    case StatusMap::CLASS_REFUNDED:
        // WHMCS does not expose a first-class refund-by-transid helper across
        // all rails; log so admins can reconcile in the Transactions list.
        logTransaction($moduleName, $event, 'Refunded — ' . (string) $eventType);
        break;

    default:
        logTransaction($moduleName, $event, 'Unhandled — ' . (string) $eventType);
        break;
}

http_response_code(200);
echo json_encode(['received' => true]);
