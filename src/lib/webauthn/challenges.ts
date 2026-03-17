/**
 * In-memory challenge store with 5-minute TTL.
 * Fine for single-instance Railway deployments.
 */

interface ChallengeEntry {
  challenge: string;
  expiresAt: number;
}

const challenges = new Map<string, ChallengeEntry>();

const TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Store a challenge for a user
 */
export function storeChallenge(userId: string, challenge: string): void {
  // Clean up expired entries periodically
  if (challenges.size > 1000) {
    cleanup();
  }
  challenges.set(userId, {
    challenge,
    expiresAt: Date.now() + TTL_MS,
  });
}

/**
 * Retrieve and consume a challenge for a user
 */
export function consumeChallenge(userId: string): string | null {
  const entry = challenges.get(userId);
  if (!entry) return null;

  challenges.delete(userId);

  if (Date.now() > entry.expiresAt) return null;
  return entry.challenge;
}

function cleanup(): void {
  const now = Date.now();
  for (const [key, entry] of challenges) {
    if (now > entry.expiresAt) {
      challenges.delete(key);
    }
  }
}
