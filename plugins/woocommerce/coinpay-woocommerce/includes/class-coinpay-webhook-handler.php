<?php

if (!defined('ABSPATH')) {
    exit;
}

use CoinPay\Webhook;
use CoinPay\StatusMap;

/**
 * Receives CoinPay webhook POSTs and applies the event to the matching
 * WooCommerce order.
 *
 * Endpoint: https://<site>/?wc-api=coinpay
 *   (WooCommerce rewrites this to /wc-api/coinpay.)
 *
 * Correlation:
 *   We write _coinpay_payment_id on the order at session creation and also
 *   include order_id/order_key in metadata, so we can recover the order from
 *   any of: payment id, metadata.order_id, or metadata.order_key.
 */
class CoinPay_WC_Webhook_Handler
{
    const API_ENDPOINT = 'coinpay';

    public static function register(): void
    {
        add_action('woocommerce_api_' . self::API_ENDPOINT, [__CLASS__, 'handle']);
    }

    public static function get_webhook_url(): string
    {
        // WC's get_home_url normalization; use add_query_arg so it respects permalinks.
        if (function_exists('WC') && method_exists(WC(), 'api_request_url')) {
            return WC()->api_request_url(self::API_ENDPOINT);
        }
        return add_query_arg('wc-api', self::API_ENDPOINT, home_url('/'));
    }

    public static function handle(): void
    {
        $raw = file_get_contents('php://input');
        if ($raw === false) {
            $raw = '';
        }

        $signature = isset($_SERVER['HTTP_X_COINPAY_SIGNATURE']) ? (string) $_SERVER['HTTP_X_COINPAY_SIGNATURE'] : '';

        $settings = get_option('woocommerce_coinpay_settings', []);
        $secret   = isset($settings['webhook_secret']) ? trim((string) $settings['webhook_secret']) : '';

        if ($secret === '' || $raw === '' || $signature === '') {
            CoinPay_WC_Logger::warning('Webhook rejected: missing secret, body, or signature.', [
                'has_secret'    => $secret !== '',
                'has_body'      => $raw !== '',
                'has_signature' => $signature !== '',
            ]);
            self::respond(401, ['error' => 'invalid signature']);
            return;
        }

        if (!Webhook::verify($raw, $signature, $secret)) {
            CoinPay_WC_Logger::warning('Webhook rejected: signature verification failed.');
            self::respond(401, ['error' => 'invalid signature']);
            return;
        }

        try {
            $event = Webhook::parse($raw);
        } catch (\Throwable $e) {
            CoinPay_WC_Logger::warning('Webhook rejected: body parse failed.', ['message' => $e->getMessage()]);
            self::respond(400, ['error' => 'invalid json']);
            return;
        }

        $event_id   = $event['id'];
        $event_type = $event['type'];
        $data       = $event['data'];
        $payment    = isset($data['payment']) && is_array($data['payment']) ? $data['payment'] : $data;

        $payment_id = $payment['id']
            ?? $payment['payment_id']
            ?? $data['payment_id']
            ?? null;

        $order = self::locate_order($payment, $data);
        if (!$order) {
            CoinPay_WC_Logger::warning('Webhook order not found.', [
                'event_id'   => $event_id,
                'event_type' => $event_type,
                'payment_id' => $payment_id,
            ]);
            // Still ACK 200 so CoinPay stops retrying for a clearly unmatchable payload.
            self::respond(200, ['received' => true, 'matched' => false]);
            return;
        }

        // Idempotency: drop duplicate deliveries of the same event id.
        if ($event_id) {
            $seen = (array) $order->get_meta('_coinpay_event_ids');
            if (in_array($event_id, $seen, true)) {
                CoinPay_WC_Logger::debug('Webhook duplicate event ignored.', [
                    'event_id' => $event_id,
                    'order_id' => $order->get_id(),
                ]);
                self::respond(200, ['received' => true, 'duplicate' => true]);
                return;
            }
            $seen[] = $event_id;
            $order->update_meta_data('_coinpay_event_ids', array_values(array_slice($seen, -50)));
        }

        if ($payment_id) {
            $order->update_meta_data('_coinpay_payment_id', (string) $payment_id);
        }

        $raw_status = isset($payment['status']) ? (string) $payment['status'] : null;
        $class      = StatusMap::classifyEvent($event_type, $raw_status);

        self::apply_class_to_order($order, $class, $event_type, $raw_status, $payment_id);
        $order->save();

        CoinPay_WC_Logger::info('Webhook applied.', [
            'event_id'   => $event_id,
            'event_type' => $event_type,
            'status'     => $raw_status,
            'class'      => $class,
            'order_id'   => $order->get_id(),
            'payment_id' => $payment_id,
        ]);

        self::respond(200, ['received' => true]);
    }

    private static function apply_class_to_order(WC_Order $order, string $class, ?string $event_type, ?string $raw_status, ?string $payment_id): void
    {
        $note_suffix = sprintf(
            /* translators: %1$s event type, %2$s raw status, %3$s payment id */
            __('(event: %1$s, status: %2$s, payment: %3$s)', 'coinpay-woocommerce'),
            (string) $event_type,
            (string) $raw_status,
            (string) $payment_id
        );

        switch ($class) {
            case StatusMap::CLASS_PAID:
                if (!$order->is_paid()) {
                    $order->payment_complete($payment_id ? (string) $payment_id : '');
                }
                $order->add_order_note(__('CoinPay payment completed. ', 'coinpay-woocommerce') . $note_suffix);
                break;

            case StatusMap::CLASS_PENDING:
                if ($order->needs_payment()) {
                    $order->update_status('on-hold', __('CoinPay payment pending confirmation. ', 'coinpay-woocommerce') . $note_suffix);
                } else {
                    $order->add_order_note(__('CoinPay payment still pending. ', 'coinpay-woocommerce') . $note_suffix);
                }
                break;

            case StatusMap::CLASS_FAILED:
                $order->update_status('failed', __('CoinPay payment failed. ', 'coinpay-woocommerce') . $note_suffix);
                break;

            case StatusMap::CLASS_EXPIRED:
                $order->update_status('cancelled', __('CoinPay payment expired. ', 'coinpay-woocommerce') . $note_suffix);
                break;

            case StatusMap::CLASS_REFUNDED:
                $order->update_status('refunded', __('CoinPay payment refunded. ', 'coinpay-woocommerce') . $note_suffix);
                break;

            default:
                $order->add_order_note(__('CoinPay event received with unrecognized status. ', 'coinpay-woocommerce') . $note_suffix);
                break;
        }
    }

    /**
     * Find the WC order associated with an incoming webhook payload.
     */
    private static function locate_order(array $payment, array $data): ?WC_Order
    {
        $payment_id = $payment['id'] ?? $payment['payment_id'] ?? $data['payment_id'] ?? null;

        if ($payment_id) {
            $orders = wc_get_orders([
                'limit'      => 1,
                'meta_key'   => '_coinpay_payment_id',
                'meta_value' => (string) $payment_id,
            ]);
            if (!empty($orders)) {
                return $orders[0];
            }
        }

        $metadata = [];
        foreach ([$payment['metadata'] ?? null, $data['metadata'] ?? null] as $candidate) {
            if (is_array($candidate)) {
                $metadata = array_merge($metadata, $candidate);
            }
        }

        if (!empty($metadata['order_id'])) {
            $order = wc_get_order((int) $metadata['order_id']);
            if ($order) {
                if (!empty($metadata['order_key']) && $order->get_order_key() !== $metadata['order_key']) {
                    CoinPay_WC_Logger::warning('Order key mismatch on incoming webhook; ignoring for safety.', [
                        'order_id' => $order->get_id(),
                    ]);
                    return null;
                }
                return $order;
            }
        }

        if (!empty($metadata['order_key'])) {
            $order_id = wc_get_order_id_by_order_key((string) $metadata['order_key']);
            if ($order_id) {
                return wc_get_order($order_id);
            }
        }

        return null;
    }

    private static function respond(int $status, array $body): void
    {
        status_header($status);
        nocache_headers();
        wp_send_json($body, $status);
    }
}
