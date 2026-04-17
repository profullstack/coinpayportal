<?php

require_once __DIR__ . '/../src/Webhook.php';

use CoinPay\Webhook;

function assert_true($cond, $label) {
    if ($cond) {
        echo "[pass] $label\n";
        return;
    }
    echo "[FAIL] $label\n";
    exit(1);
}

$secret = 'whsec_test_123';
$body   = json_encode(['id' => 'evt_1', 'type' => 'payment.completed', 'data' => ['payment_id' => 'pay_1']]);

// happy path
$sig = Webhook::sign($body, $secret);
assert_true(Webhook::verify($body, $sig, $secret), 'valid signature verifies');

// tampered body
assert_true(!Webhook::verify($body . 'x', $sig, $secret), 'tampered body rejected');

// wrong secret
assert_true(!Webhook::verify($body, $sig, 'whsec_other'), 'wrong secret rejected');

// stale timestamp
$stale = Webhook::sign($body, $secret, time() - 3600);
assert_true(!Webhook::verify($body, $stale, $secret), 'stale timestamp rejected');

// malformed header
assert_true(!Webhook::verify($body, 'not-a-header', $secret), 'malformed header rejected');

// parse
$parsed = Webhook::parse($body);
assert_true($parsed['id'] === 'evt_1' && $parsed['type'] === 'payment.completed', 'parse extracts fields');

echo "\nAll Webhook tests passed.\n";
