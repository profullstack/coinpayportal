/**
 * Client half of the post-login landing decision.
 *
 * Kept deliberately forgiving: if the lookup fails for any reason the user still
 * lands on the dashboard. A wallet-review prompt is never worth blocking a
 * sign-in over.
 */

const DEFAULT_PATH = '/dashboard';

export async function resolveLandingPath(token: string): Promise<string> {
  if (!token) return DEFAULT_PATH;

  try {
    const response = await fetch('/api/auth/landing', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    if (!response.ok || !body?.path) return DEFAULT_PATH;

    // Surfaced as a query param so the wallets page can explain why the user
    // was sent there rather than dropping them in cold.
    return body.reason ? `${body.path}?from=login&reason=${body.reason}` : body.path;
  } catch {
    return DEFAULT_PATH;
  }
}
