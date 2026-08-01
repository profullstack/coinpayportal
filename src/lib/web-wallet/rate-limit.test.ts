import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkRateLimit,
  resetRateLimits,
  checkAndRecordSignature,
  resetSeenSignatures,
  RATE_LIMITS,
} from './rate-limit';

describe('rate-limit', () => {
  beforeEach(() => {
    resetRateLimits();
    resetSeenSignatures();
  });

  // ────────────────────────────────────
  // Rate Limiter
  // ────────────────────────────────────

  describe('checkRateLimit', () => {
    it('should allow first request', () => {
      const result = checkRateLimit('192.168.1.1', 'auth_challenge');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(RATE_LIMITS['auth_challenge'].limit - 1);
    });

    it('should decrement remaining count on successive requests', () => {
      const r1 = checkRateLimit('10.0.0.1', 'auth_challenge');
      const r2 = checkRateLimit('10.0.0.1', 'auth_challenge');
      const r3 = checkRateLimit('10.0.0.1', 'auth_challenge');

      const limit = RATE_LIMITS['auth_challenge'].limit;
      expect(r1.remaining).toBe(limit - 1);
      expect(r2.remaining).toBe(limit - 2);
      expect(r3.remaining).toBe(limit - 3);
    });

    it('should block after limit is reached', () => {
      const limit = RATE_LIMITS['wallet_creation'].limit; // 5

      for (let i = 0; i < limit; i++) {
        const r = checkRateLimit('abuser', 'wallet_creation');
        expect(r.allowed).toBe(true);
      }

      const blocked = checkRateLimit('abuser', 'wallet_creation');
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
    });

    it('should track different keys independently', () => {
      const limit = RATE_LIMITS['wallet_creation'].limit;

      // Exhaust key A
      for (let i = 0; i < limit; i++) {
        checkRateLimit('keyA', 'wallet_creation');
      }

      // Key A is blocked
      expect(checkRateLimit('keyA', 'wallet_creation').allowed).toBe(false);

      // Key B is still allowed
      expect(checkRateLimit('keyB', 'wallet_creation').allowed).toBe(true);
    });

    it('should track different categories independently', () => {
      const limit = RATE_LIMITS['wallet_creation'].limit; // 5

      // Exhaust wallet_creation for this IP
      for (let i = 0; i < limit; i++) {
        checkRateLimit('ip1', 'wallet_creation');
      }

      expect(checkRateLimit('ip1', 'wallet_creation').allowed).toBe(false);

      // But auth_challenge should still work for same IP
      expect(checkRateLimit('ip1', 'auth_challenge').allowed).toBe(true);
    });

    it('should return allowed for unknown category', () => {
      const result = checkRateLimit('key', 'nonexistent_category');
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(0);
    });

    it('should include resetAt timestamp', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const result = checkRateLimit('ip', 'auth_challenge');

      // resetAt should be roughly now + windowSeconds
      expect(result.resetAt).toBeGreaterThanOrEqual(nowSec);
      expect(result.resetAt).toBeLessThanOrEqual(
        nowSec + RATE_LIMITS['auth_challenge'].windowSeconds + 1
      );
    });

    it('should report correct limit value', () => {
      const result = checkRateLimit('ip', 'broadcast_tx');
      expect(result.limit).toBe(RATE_LIMITS['broadcast_tx'].limit);
    });

    // The extension's payBatch sends up to MAX_BATCH_SIZE payments behind one
    // approval (packages/extension/src/background/index.ts), and each payment
    // costs one prepare-tx plus one broadcast. Limits below that silently kill
    // a bulk run partway through, which reads to the payer as "some invoices
    // just didn't pay" — so the budget is asserted against the batch size.
    describe('bulk payouts', () => {
      const MAX_BATCH_SIZE = 500;
      /** Payments/minute the batch runner tops out at (~4s settle on EVM/SOL). */
      const RUNNER_PACE_PER_MIN = 15;

      it('lets one wallet prepare and broadcast a full batch', () => {
        for (let i = 0; i < MAX_BATCH_SIZE; i++) {
          expect(checkRateLimit('wallet-1', 'prepare_tx_wallet').allowed).toBe(true);
          expect(checkRateLimit('wallet-1', 'broadcast_tx_wallet').allowed).toBe(true);
        }
      });

      it('leaves per-wallet headroom for the runner retries', () => {
        expect(RATE_LIMITS['prepare_tx_wallet'].limit).toBeGreaterThan(MAX_BATCH_SIZE);
        expect(RATE_LIMITS['broadcast_tx_wallet'].limit).toBeGreaterThan(MAX_BATCH_SIZE);
      });

      it('does not trip the per-IP cap at the runner pace', () => {
        for (let i = 0; i < RUNNER_PACE_PER_MIN; i++) {
          expect(checkRateLimit('1.2.3.4', 'prepare_tx').allowed).toBe(true);
          expect(checkRateLimit('1.2.3.4', 'broadcast_tx').allowed).toBe(true);
        }
      });

      it('still bounds a wallet that blows past a full batch', () => {
        const limit = RATE_LIMITS['broadcast_tx_wallet'].limit;
        for (let i = 0; i < limit; i++) {
          checkRateLimit('wallet-2', 'broadcast_tx_wallet');
        }
        expect(checkRateLimit('wallet-2', 'broadcast_tx_wallet').allowed).toBe(false);
      });

      it('budgets each wallet separately', () => {
        const limit = RATE_LIMITS['prepare_tx_wallet'].limit;
        for (let i = 0; i < limit; i++) {
          checkRateLimit('wallet-3', 'prepare_tx_wallet');
        }
        expect(checkRateLimit('wallet-3', 'prepare_tx_wallet').allowed).toBe(false);
        expect(checkRateLimit('wallet-4', 'prepare_tx_wallet').allowed).toBe(true);
      });
    });

    it('should reset properly', () => {
      const limit = RATE_LIMITS['wallet_creation'].limit;

      for (let i = 0; i < limit; i++) {
        checkRateLimit('ip', 'wallet_creation');
      }
      expect(checkRateLimit('ip', 'wallet_creation').allowed).toBe(false);

      resetRateLimits();

      expect(checkRateLimit('ip', 'wallet_creation').allowed).toBe(true);
    });
  });

  // ────────────────────────────────────
  // Replay Prevention
  // ────────────────────────────────────

  describe('checkAndRecordSignature', () => {
    it('should allow a fresh signature', () => {
      const result = checkAndRecordSignature('sig:abc:123');
      expect(result).toBe(true);
    });

    it('should reject a repeated signature', () => {
      checkAndRecordSignature('sig:repeated:1');
      const result = checkAndRecordSignature('sig:repeated:1');
      expect(result).toBe(false);
    });

    it('should allow different signatures', () => {
      expect(checkAndRecordSignature('sig:a:1')).toBe(true);
      expect(checkAndRecordSignature('sig:b:2')).toBe(true);
      expect(checkAndRecordSignature('sig:c:3')).toBe(true);
    });

    it('should reject on third attempt too', () => {
      checkAndRecordSignature('sig:triple:1');
      expect(checkAndRecordSignature('sig:triple:1')).toBe(false);
      expect(checkAndRecordSignature('sig:triple:1')).toBe(false);
    });

    it('should reset properly', () => {
      checkAndRecordSignature('sig:reset:1');
      expect(checkAndRecordSignature('sig:reset:1')).toBe(false);

      resetSeenSignatures();

      expect(checkAndRecordSignature('sig:reset:1')).toBe(true);
    });

    it('should handle empty string key', () => {
      expect(checkAndRecordSignature('')).toBe(true);
      expect(checkAndRecordSignature('')).toBe(false);
    });
  });

  // ────────────────────────────────────
  // RATE_LIMITS configuration
  // ────────────────────────────────────

  describe('RATE_LIMITS config', () => {
    it('should have wallet_creation limits', () => {
      expect(RATE_LIMITS['wallet_creation']).toBeDefined();
      expect(RATE_LIMITS['wallet_creation'].limit).toBe(10);
      expect(RATE_LIMITS['wallet_creation'].windowSeconds).toBe(3600);
    });

    it('should have auth_challenge limits', () => {
      expect(RATE_LIMITS['auth_challenge']).toBeDefined();
      expect(RATE_LIMITS['auth_challenge'].limit).toBe(30);
      expect(RATE_LIMITS['auth_challenge'].windowSeconds).toBe(60);
    });

    it('should have auth_verify limits', () => {
      expect(RATE_LIMITS['auth_verify']).toBeDefined();
      expect(RATE_LIMITS['auth_verify'].limit).toBe(30);
      expect(RATE_LIMITS['auth_verify'].windowSeconds).toBe(60);
    });

    // Was 10/min, which was below the batch runner's pace and cut bulk payouts
    // off after ~10 payments. The per-IP cap is now a shared-NAT-safe shield;
    // broadcast_tx_wallet is what actually bounds a single wallet.
    it('should have broadcast_tx limits', () => {
      expect(RATE_LIMITS['broadcast_tx']).toBeDefined();
      expect(RATE_LIMITS['broadcast_tx'].limit).toBe(60);
      expect(RATE_LIMITS['broadcast_tx'].windowSeconds).toBe(60);
    });

    it('should have per-wallet transaction limits', () => {
      expect(RATE_LIMITS['prepare_tx_wallet']).toBeDefined();
      expect(RATE_LIMITS['prepare_tx_wallet'].windowSeconds).toBe(3600);
      expect(RATE_LIMITS['broadcast_tx_wallet']).toBeDefined();
      expect(RATE_LIMITS['broadcast_tx_wallet'].windowSeconds).toBe(3600);
    });

    it('should have all expected categories defined', () => {
      const expectedCategories = [
        'wallet_creation',
        'auth_challenge',
        'auth_verify',
        'balance_query',
        'tx_history',
        'prepare_tx',
        'broadcast_tx',
      ];
      for (const cat of expectedCategories) {
        expect(RATE_LIMITS[cat]).toBeDefined();
        expect(RATE_LIMITS[cat].limit).toBeGreaterThan(0);
        expect(RATE_LIMITS[cat].windowSeconds).toBeGreaterThan(0);
      }
    });
  });
});
