<?php

require_once __DIR__ . '/TestHelpers.php';
require_once __DIR__ . '/../src/ApiException.php';
require_once __DIR__ . '/../src/Client.php';

use CoinPay\Client;
use CoinPay\ApiException;

/**
 * Integration tests for CoinPay\Client using the injectable transport.
 *
 * We don't hit the network — Client::__construct accepts a `transport`
 * callable that replaces cURL. The mock captures the request and returns
 * a canned response, which is exactly the contract we'd want to verify
 * at integration boundaries anyway.
 */

/**
 * Build a client with a mock transport. Returns [$client, $captured] where
 * $captured is an ArrayObject that the transport fills in on each call.
 * (Plain-array references don't survive list destructuring in PHP, so we
 * use ArrayObject which is inherently passed by handle.)
 */
function make_client(callable $handler, array $config = []): array
{
    $captured = new \ArrayObject();
    $transport = function ($method, $url, $headers, $body, $timeout) use ($handler, $captured) {
        $captured->append([
            'method'  => $method,
            'url'     => $url,
            'headers' => $headers,
            'body'    => $body,
            'timeout' => $timeout,
        ]);
        return $handler($method, $url, $headers, $body, $timeout);
    };

    $client = new Client(array_merge([
        'api_key'   => 'sk_test_123',
        'transport' => $transport,
    ], $config));

    return [$client, $captured];
}

// ── constructor contract ───────────────────────────────────────

coinpay_test_run('throws when api_key missing', function () {
    coinpay_assert_throws(function () {
        new Client([]);
    }, \InvalidArgumentException::class);
});

coinpay_test_run('defaults to production base URL', function () {
    [$client, ] = make_client(function () {
        return ['status' => 200, 'body' => '{"businesses":[]}'];
    });
    coinpay_assert_equals('https://coinpayportal.com/api', $client->getBaseUrl());
});

coinpay_test_run('strips trailing slash from custom base URL', function () {
    [$client, ] = make_client(function () {
        return ['status' => 200, 'body' => '{}'];
    }, ['base_url' => 'https://staging.example.com/api/']);
    coinpay_assert_equals('https://staging.example.com/api', $client->getBaseUrl());
});

// ── createCryptoPayment ────────────────────────────────────────

coinpay_test_run('createCryptoPayment hits /payments/create with snake_case body', function () {
    [$client, $captured] = make_client(function () {
        return ['status' => 200, 'body' => json_encode([
            'payment' => ['id' => 'pay_abc', 'checkout_url' => 'https://coinpayportal.com/c/abc'],
        ])];
    });

    $response = $client->createCryptoPayment([
        'business_id' => 'biz_1',
        'amount'      => 49.99,
        'currency'    => 'usd',
        'blockchain'  => 'btc',
        'description' => 'Order #42',
        'metadata'    => ['order_id' => '42'],
    ]);

    coinpay_assert_equals(1, count($captured));
    coinpay_assert_equals('POST', $captured[0]['method']);
    coinpay_assert_equals('https://coinpayportal.com/api/payments/create', $captured[0]['url']);

    $body = json_decode($captured[0]['body'], true);
    coinpay_assert_equals('biz_1', $body['business_id']);
    coinpay_assert_equals(49.99, $body['amount']);
    coinpay_assert_equals('USD', $body['currency'],  'currency uppercased');
    coinpay_assert_equals('BTC', $body['blockchain'], 'blockchain uppercased');
    coinpay_assert_equals('Order #42', $body['description']);
    coinpay_assert_equals(['order_id' => '42'], $body['metadata']);

    coinpay_assert_equals('pay_abc', $response['payment']['id']);
});

coinpay_test_run('createCryptoPayment requires business_id/amount/blockchain', function () {
    [$client, ] = make_client(function () { return ['status' => 200, 'body' => '{}']; });

    foreach ([
        ['amount' => 10, 'blockchain' => 'BTC'],           // missing business_id
        ['business_id' => 'biz_1', 'blockchain' => 'BTC'], // missing amount
        ['business_id' => 'biz_1', 'amount' => 10],        // missing blockchain
    ] as $partial) {
        coinpay_assert_throws(function () use ($client, $partial) {
            $client->createCryptoPayment($partial);
        }, \InvalidArgumentException::class);
    }
});

// ── createCardPayment ──────────────────────────────────────────

coinpay_test_run('createCardPayment hits /stripe/payments/create with camelCase body', function () {
    [$client, $captured] = make_client(function () {
        return ['status' => 200, 'body' => json_encode([
            'id'           => 'pi_test_1',
            'checkout_url' => 'https://checkout.stripe.com/c/pi_test_1',
        ])];
    });

    $client->createCardPayment([
        'business_id' => 'biz_1',
        'amount'      => 4999,
        'currency'    => 'USD',
        'description' => 'Order #42',
        'metadata'    => ['order_id' => '42'],
        'success_url' => 'https://merchant.example.com/success',
        'cancel_url'  => 'https://merchant.example.com/cancel',
    ]);

    coinpay_assert_equals('POST', $captured[0]['method']);
    coinpay_assert_equals('https://coinpayportal.com/api/stripe/payments/create', $captured[0]['url']);

    $body = json_decode($captured[0]['body'], true);
    coinpay_assert_equals('biz_1', $body['businessId'], 'camelCase businessId');
    coinpay_assert_equals(4999, $body['amount'],        'amount kept as cents int');
    coinpay_assert_equals('usd', $body['currency'],     'currency lowercased for Stripe');
    coinpay_assert_equals('https://merchant.example.com/success', $body['successUrl']);
    coinpay_assert_equals('https://merchant.example.com/cancel',  $body['cancelUrl']);
    coinpay_assert_equals(false, $body['escrowMode']);
    coinpay_assert_equals(['order_id' => '42'], $body['metadata']);
});

coinpay_test_run('createCardPayment coerces amount to int (no silent truncation traps)', function () {
    [$client, $captured] = make_client(function () {
        return ['status' => 200, 'body' => '{}'];
    });

    $client->createCardPayment([
        'business_id' => 'biz_1',
        'amount'      => '2500',  // string — must come out as int 2500
    ]);

    $body = json_decode($captured[0]['body'], true);
    coinpay_assert_equals(2500, $body['amount']);
    coinpay_assert_true(is_int($body['amount']), 'amount must be int after coercion');
});

// ── auth + headers ─────────────────────────────────────────────

coinpay_test_run('sends bearer token, accept, and user-agent headers', function () {
    [$client, $captured] = make_client(function () {
        return ['status' => 200, 'body' => '{}'];
    });

    $client->createCryptoPayment([
        'business_id' => 'biz_1',
        'amount'      => 10,
        'blockchain'  => 'BTC',
    ]);

    $joined = implode("\n", $captured[0]['headers']);
    coinpay_assert_contains('Authorization: Bearer sk_test_123', $joined);
    coinpay_assert_contains('Accept: application/json',           $joined);
    coinpay_assert_contains('User-Agent: coinpay-php/',           $joined);
    coinpay_assert_contains('Content-Type: application/json',     $joined, 'content-type set on requests with a body');
});

coinpay_test_run('GET requests omit content-type header', function () {
    [$client, $captured] = make_client(function () {
        return ['status' => 200, 'body' => '{}'];
    });

    $client->getPayment('pay_abc');

    $joined = implode("\n", $captured[0]['headers']);
    coinpay_assert_true(strpos($joined, 'Content-Type:') === false, 'no content-type on GET');
    coinpay_assert_equals('GET', $captured[0]['method']);
    coinpay_assert_equals('https://coinpayportal.com/api/payments/pay_abc', $captured[0]['url']);
});

coinpay_test_run('getPayment rawurlencodes the payment id', function () {
    [$client, $captured] = make_client(function () {
        return ['status' => 200, 'body' => '{}'];
    });
    $client->getPayment('pay abc/with spaces');
    coinpay_assert_contains('pay%20abc%2Fwith%20spaces', $captured[0]['url']);
});

// ── error handling ─────────────────────────────────────────────

coinpay_test_run('non-2xx response throws ApiException with status + body', function () {
    [$client, ] = make_client(function () {
        return ['status' => 403, 'body' => json_encode([
            'error' => 'invalid_api_key',
        ])];
    });

    $e = coinpay_assert_throws(function () use ($client) {
        $client->getPayment('pay_abc');
    }, ApiException::class);

    /** @var ApiException $e */
    coinpay_assert_equals(403, $e->getHttpStatus());
    coinpay_assert_equals('invalid_api_key', $e->getMessage());
    coinpay_assert_equals(['error' => 'invalid_api_key'], $e->getResponseBody());
});

coinpay_test_run('non-JSON error body yields "HTTP {status}" message', function () {
    [$client, ] = make_client(function () {
        return ['status' => 502, 'body' => '<html>bad gateway</html>'];
    });

    $e = coinpay_assert_throws(function () use ($client) {
        $client->getPayment('pay_abc');
    }, ApiException::class);

    /** @var ApiException $e */
    coinpay_assert_equals(502, $e->getHttpStatus());
    coinpay_assert_equals('HTTP 502', $e->getMessage());
});

coinpay_test_run('ping delegates to GET /businesses', function () {
    [$client, $captured] = make_client(function () {
        return ['status' => 200, 'body' => '{"businesses":[{"id":"biz_1"}]}'];
    });
    $res = $client->ping();
    coinpay_assert_equals('GET', $captured[0]['method']);
    coinpay_assert_equals('https://coinpayportal.com/api/businesses', $captured[0]['url']);
    coinpay_assert_equals('biz_1', $res['businesses'][0]['id']);
});

coinpay_test_summary();
