<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../../../src/WebhookVerifier.php';

/**
 * These tests previously encoded the WRONG protocol — `sha256=<hmac>` over the
 * bare body — which is not what CoinPayPortal sends. They passed against a
 * verifier that could never accept a real delivery, so the suite was green
 * while the integration was completely broken in production. They now assert
 * the actual contract: `t=<unix>,v1=<hmac>` over "{timestamp}.{rawBody}".
 */
class WebhookVerifierTest extends TestCase
{
    private const SECRET = 'test_webhook_secret_abc123';
    private const BODY   = '{"id":"evt_1","type":"payment.completed"}';

    private function makeSignature(string $body, string $secret, ?int $timestamp = null): string
    {
        return WebhookVerifier::sign($body, $secret, $timestamp);
    }

    public function testValidSignaturePasses(): void
    {
        $sig = $this->makeSignature(self::BODY, self::SECRET);
        $this->assertTrue(WebhookVerifier::verify(self::BODY, $sig, self::SECRET));
    }

    public function testInvalidSignatureFails(): void
    {
        $this->assertFalse(
            WebhookVerifier::verify(self::BODY, 't=' . time() . ',v1=deadbeefdeadbeef', self::SECRET)
        );
    }

    public function testMissingTimestampFails(): void
    {
        $hash = hash_hmac('sha256', time() . '.' . self::BODY, self::SECRET);
        $this->assertFalse(WebhookVerifier::verify(self::BODY, 'v1=' . $hash, self::SECRET));
    }

    public function testLegacyPrefixedFormatIsRejected(): void
    {
        // The format this class used to expect. It is not what the server
        // sends, and accepting it would mean accepting an unsigned timestamp.
        $hash = hash_hmac('sha256', self::BODY, self::SECRET);
        $this->assertFalse(WebhookVerifier::verify(self::BODY, 'sha256=' . $hash, self::SECRET));
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

    public function testEmptyBodyFails(): void
    {
        $sig = $this->makeSignature('', self::SECRET);
        $this->assertFalse(WebhookVerifier::verify('', $sig, self::SECRET));
    }

    public function testTamperedBodyFails(): void
    {
        $sig      = $this->makeSignature(self::BODY, self::SECRET);
        $tampered = self::BODY . ' ';
        $this->assertFalse(WebhookVerifier::verify($tampered, $sig, self::SECRET));
    }

    public function testEmptySignatureValueFails(): void
    {
        $this->assertFalse(WebhookVerifier::verify(self::BODY, 't=' . time() . ',v1=', self::SECRET));
    }

    public function testWrongSecretFails(): void
    {
        $sig = $this->makeSignature(self::BODY, 'wrong_secret');
        $this->assertFalse(WebhookVerifier::verify(self::BODY, $sig, self::SECRET));
    }

    public function testStaleSignatureFails(): void
    {
        // A captured delivery must not stay replayable forever.
        $sig = $this->makeSignature(self::BODY, self::SECRET, time() - 3600);
        $this->assertFalse(WebhookVerifier::verify(self::BODY, $sig, self::SECRET));
    }

    public function testEditedTimestampFails(): void
    {
        // The timestamp is signed, so bumping it to defeat the freshness check
        // invalidates the HMAC.
        $old = time() - 3600;
        $sig = $this->makeSignature(self::BODY, self::SECRET, $old);
        $forged = preg_replace('/^t=\d+/', 't=' . time(), $sig);
        $this->assertFalse(WebhookVerifier::verify(self::BODY, (string) $forged, self::SECRET));
    }

    public function testSignatureWithinTolerancePasses(): void
    {
        $sig = $this->makeSignature(self::BODY, self::SECRET, time() - 60);
        $this->assertTrue(WebhookVerifier::verify(self::BODY, $sig, self::SECRET));
    }
}
