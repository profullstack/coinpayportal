<?php
declare(strict_types=1);

class CoinPayPortalClient
{
    private string $baseUrl;
    private string $apiKey;
    private bool $debug;
    private ?callable $logger;

    public function __construct(
        string $baseUrl,
        string $apiKey,
        bool $debug = false,
        ?callable $logger = null
    ) {
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->apiKey  = $apiKey;
        $this->debug   = $debug;
        $this->logger  = $logger;
    }

    public function createCheckout(array $payload): array
    {
        return $this->request('POST', '/v1/checkouts', $payload);
    }

    public function getPayment(string $paymentId): array
    {
        return $this->request('GET', '/v1/payments/' . urlencode($paymentId));
    }

    private function request(string $method, string $path, array $body = []): array
    {
        $url = $this->baseUrl . $path;

        $headers = [
            'Authorization: Bearer ' . $this->apiKey,
            'Content-Type: application/json',
            'Accept: application/json',
        ];

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

        if ($method === 'POST') {
            $json = json_encode($body);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $json);
        }

        if ($this->debug && $this->logger) {
            ($this->logger)(sprintf('[CoinPayPortal] %s %s', $method, $url));
        }

        $responseBody = curl_exec($ch);
        $httpCode     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError    = curl_error($ch);
        curl_close($ch);

        if ($curlError) {
            throw new RuntimeException('CoinPayPortal request failed: ' . $curlError);
        }

        if ($this->debug && $this->logger) {
            ($this->logger)(sprintf('[CoinPayPortal] Response %d: %s', $httpCode, $responseBody));
        }

        $decoded = json_decode((string)$responseBody, true);

        if ($httpCode < 200 || $httpCode >= 300) {
            $errorMsg = is_array($decoded) && isset($decoded['message'])
                ? $decoded['message']
                : 'Unexpected response';
            throw new RuntimeException(
                sprintf('CoinPayPortal API error %d: %s', $httpCode, $errorMsg)
            );
        }

        if (!is_array($decoded)) {
            throw new RuntimeException('CoinPayPortal returned invalid JSON');
        }

        return $decoded;
    }
}
