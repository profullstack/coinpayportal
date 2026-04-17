<?php

namespace CoinPay;

/**
 * CoinPay API client (PHP).
 *
 * Mirrors the JS client in packages/sdk/src/client.js:
 *   - Base URL:     https://coinpayportal.com/api (default)
 *   - Auth:         Authorization: Bearer <apiKey>
 *   - Crypto pay:   POST /payments/create
 *   - Card pay:     POST /stripe/payments/create
 *   - Lookup:       GET  /payments/{id}
 */
class Client
{
    public const DEFAULT_BASE_URL = 'https://coinpayportal.com/api';
    public const DEFAULT_TIMEOUT  = 30;
    public const USER_AGENT       = 'coinpay-php/0.1.0';

    /** @var string */
    private $apiKey;

    /** @var string */
    private $baseUrl;

    /** @var int */
    private $timeout;

    /** @var callable|null */
    private $transport;

    /**
     * @param array{api_key:string,base_url?:string,timeout?:int,transport?:callable} $config
     */
    public function __construct(array $config)
    {
        if (empty($config['api_key'])) {
            throw new \InvalidArgumentException('CoinPay\\Client: api_key is required');
        }

        $this->apiKey    = (string) $config['api_key'];
        $this->baseUrl   = rtrim((string) ($config['base_url'] ?? self::DEFAULT_BASE_URL), '/');
        $this->timeout   = (int) ($config['timeout'] ?? self::DEFAULT_TIMEOUT);
        $this->transport = isset($config['transport']) && is_callable($config['transport']) ? $config['transport'] : null;
    }

    public function getBaseUrl(): string
    {
        return $this->baseUrl;
    }

    /**
     * Create a crypto payment session.
     *
     * @param array{business_id:string,amount:float|int,currency?:string,blockchain:string,description?:string,metadata?:array} $params
     */
    public function createCryptoPayment(array $params): array
    {
        foreach (['business_id', 'amount', 'blockchain'] as $k) {
            if (!array_key_exists($k, $params)) {
                throw new \InvalidArgumentException("createCryptoPayment: '{$k}' is required");
            }
        }

        $body = [
            'business_id' => (string) $params['business_id'],
            'amount'      => $params['amount'],
            'currency'    => strtoupper((string) ($params['currency'] ?? 'USD')),
            'blockchain'  => strtoupper((string) $params['blockchain']),
        ];

        if (!empty($params['description'])) {
            $body['description'] = (string) $params['description'];
        }
        if (!empty($params['metadata']) && is_array($params['metadata'])) {
            $body['metadata'] = $params['metadata'];
        }

        return $this->request('POST', '/payments/create', $body);
    }

    /**
     * Create a credit-card (Stripe) payment session.
     *
     * @param array{business_id:string,amount:int,currency?:string,description?:string,metadata?:array,success_url?:string,cancel_url?:string,escrow_mode?:bool} $params
     */
    public function createCardPayment(array $params): array
    {
        foreach (['business_id', 'amount'] as $k) {
            if (!array_key_exists($k, $params)) {
                throw new \InvalidArgumentException("createCardPayment: '{$k}' is required");
            }
        }

        $body = [
            'businessId'  => (string) $params['business_id'],
            'amount'      => (int) $params['amount'],
            'currency'    => strtolower((string) ($params['currency'] ?? 'usd')),
            'escrowMode'  => (bool) ($params['escrow_mode'] ?? false),
        ];

        if (!empty($params['description']))  { $body['description'] = (string) $params['description']; }
        if (!empty($params['success_url']))  { $body['successUrl']  = (string) $params['success_url']; }
        if (!empty($params['cancel_url']))   { $body['cancelUrl']   = (string) $params['cancel_url']; }
        if (!empty($params['metadata']) && is_array($params['metadata'])) {
            $body['metadata'] = $params['metadata'];
        }

        return $this->request('POST', '/stripe/payments/create', $body);
    }

    public function getPayment(string $paymentId): array
    {
        if ($paymentId === '') {
            throw new \InvalidArgumentException('getPayment: paymentId is required');
        }
        return $this->request('GET', '/payments/' . rawurlencode($paymentId));
    }

    /**
     * Lightweight connectivity + credential check.
     * Uses /businesses which requires a valid API key.
     */
    public function ping(): array
    {
        return $this->request('GET', '/businesses');
    }

    /**
     * Low-level request. Exposed for adapters that need extended endpoints.
     *
     * @param array|null $body
     * @return array Decoded JSON response.
     * @throws ApiException
     */
    public function request(string $method, string $path, ?array $body = null): array
    {
        $url = $this->baseUrl . $path;
        $headers = [
            'Authorization: Bearer ' . $this->apiKey,
            'Accept: application/json',
            'User-Agent: ' . self::USER_AGENT,
        ];
        $payload = null;
        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
            $payload   = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        }

        if ($this->transport !== null) {
            $response = call_user_func($this->transport, $method, $url, $headers, $payload, $this->timeout);
        } else {
            $response = $this->curlTransport($method, $url, $headers, $payload, $this->timeout);
        }

        $status = (int) ($response['status'] ?? 0);
        $raw    = (string) ($response['body'] ?? '');
        $decoded = $raw === '' ? [] : json_decode($raw, true);
        if (!is_array($decoded)) {
            $decoded = [];
        }

        if ($status < 200 || $status >= 300) {
            $message = $decoded['error'] ?? $decoded['message'] ?? ('HTTP ' . $status);
            throw new ApiException((string) $message, $status, $decoded);
        }

        return $decoded;
    }

    /**
     * Default cURL transport. Platform adapters (WP, WHMCS) may inject their
     * own transport to reuse the host HTTP stack — useful for proxies, TLS
     * pinning, or test harnesses.
     *
     * @return array{status:int,body:string}
     */
    private function curlTransport(string $method, string $url, array $headers, ?string $body, int $timeout): array
    {
        if (!function_exists('curl_init')) {
            throw new ApiException('cURL extension is required for CoinPay\\Client default transport');
        }

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, min($timeout, 10));
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);

        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }

        $raw = curl_exec($ch);
        if ($raw === false) {
            $err = curl_error($ch);
            curl_close($ch);
            throw new ApiException('CoinPay transport error: ' . $err);
        }

        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return ['status' => $status, 'body' => (string) $raw];
    }
}
