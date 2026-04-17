<?php

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Thin wrapper around WooCommerce's logger with secret redaction.
 *
 * The merchant toggles this on/off via the gateway settings page
 * ("Debug logging"). Logs are visible under WooCommerce → Status → Logs
 * with source = coinpay.
 */
class CoinPay_WC_Logger
{
    const SOURCE = 'coinpay';

    /** @var WC_Logger_Interface|null */
    private static $logger = null;

    private static function logger()
    {
        if (self::$logger === null && function_exists('wc_get_logger')) {
            self::$logger = wc_get_logger();
        }
        return self::$logger;
    }

    public static function enabled(): bool
    {
        $settings = get_option('woocommerce_coinpay_settings', []);
        return isset($settings['debug_logging']) && $settings['debug_logging'] === 'yes';
    }

    /**
     * @param array|object|string|null $context
     */
    public static function debug(string $message, $context = null): void
    {
        if (!self::enabled()) {
            return;
        }
        self::write('debug', $message, $context);
    }

    /**
     * @param array|object|string|null $context
     */
    public static function info(string $message, $context = null): void
    {
        self::write('info', $message, $context);
    }

    /**
     * @param array|object|string|null $context
     */
    public static function warning(string $message, $context = null): void
    {
        self::write('warning', $message, $context);
    }

    /**
     * @param array|object|string|null $context
     */
    public static function error(string $message, $context = null): void
    {
        self::write('error', $message, $context);
    }

    private static function write(string $level, string $message, $context): void
    {
        $logger = self::logger();
        if (!$logger) {
            return;
        }

        $entry = $message;
        if ($context !== null) {
            $entry .= ' ' . wp_json_encode(self::redact($context));
        }

        $logger->log($level, $entry, ['source' => self::SOURCE]);
    }

    /**
     * Recursively redact obvious secret fields from arrays before logging.
     *
     * @param mixed $value
     * @return mixed
     */
    private static function redact($value)
    {
        if (is_object($value)) {
            $value = (array) $value;
        }
        if (!is_array($value)) {
            return $value;
        }

        $blocklist = [
            'api_key', 'apikey', 'secret', 'webhook_secret', 'password',
            'authorization', 'auth', 'token', 'access_token', 'refresh_token',
        ];

        foreach ($value as $key => $v) {
            if (is_string($key) && in_array(strtolower($key), $blocklist, true)) {
                $value[$key] = '[redacted]';
                continue;
            }
            if (is_array($v) || is_object($v)) {
                $value[$key] = self::redact($v);
            }
        }

        return $value;
    }
}
