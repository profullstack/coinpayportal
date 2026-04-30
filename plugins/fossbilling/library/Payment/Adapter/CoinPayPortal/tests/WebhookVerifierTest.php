<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../../../src/WebhookVerifier.php';

class WebhookVerifierTest extends TestCase
{
    private const SECRET = 'test_webhook_secret_abc123';
    private const BODY   = '{"id":"evt_1","type":"payment.completed"}';

    private function makeSignature(string $body, string $secret): string
    {
        return 'sha256=' . hash_hmac('sha256', $body, $secret);
    }

    public function testValidSignaturePasses(): void
    {
        $sig = $this->makeSignature(self::BODY, self::SECRET);
        $this->assertTrue(WebhookVerifier::verify(self::BODY, $sig, self::SECRET));
    }

    public function testInvalidSignatureFails(): void
    {
        $this->assertFalse(
            WebhookVerifier::verify(self::BODY, 'sha256=deadbeefdeadbeef', self::SECRET)
        );
    }

    public function testMissingPrefixFails(): void
    {
        $hash = hash_hmac('sha256', self::BODY, self::SECRET);
        $this->assertFalse(WebhookVerifier::verify(self::BODY, $hash, self::SECRET));
    }

    public function testEmptySignatureHeaderFails(): void
    {
        $this->assertFalse(WebhookVerifier::verify(self::BODY, '', self::SECRET));
    }

    public function testEmptySecretFails(): void
    {
        $sig = $this->makeSignature(self::BODY, self::SECRET);
        $this->assertFalse(WebhookVerifier::verify(self::BODY, $sig, ''));
    }

    public function testTamperedBodyFails(): void
    {
        $sig     = $this->makeSignature(self::BODY, self::SECRET);
        $tampered = self::BODY . ' ';
        $this->assertFalse(WebhookVerifier::verify($tampered, $sig, self::SECRET));
    }

    public function testSha256PrefixOnlyFails(): void
    {
        $this->assertFalse(WebhookVerifier::verify(self::BODY, 'sha256=', self::SECRET));
    }

    public function testWrongSecretFails(): void
    {
        $sig = $this->makeSignature(self::BODY, 'wrong_secret');
        $this->assertFalse(WebhookVerifier::verify(self::BODY, $sig, self::SECRET));
    }
}
