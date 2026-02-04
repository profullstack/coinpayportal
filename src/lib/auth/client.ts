/**
 * Client-side auth utilities for protected pages.
 * Centralizes token management and authenticated fetch.
 */

/**
 * Get the auth token from localStorage.
 * Returns null if not available (SSR or not logged in).
 */
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

/**
 * Clear the auth token and dispatch an event so Header updates.
 */
export function clearAuthToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('auth_token');
  window.dispatchEvent(new Event('auth-change'));
}

/**
 * Authenticated fetch wrapper.
 * - Attaches Bearer token automatically
 * - On 401 response: clears stale token and redirects to /login
 * - Returns the parsed JSON response
 */
export async function authFetch(
  url: string,
  options: RequestInit = {},
  router?: { push: (url: string) => void }
): Promise<{ response: Response; data: any } | null> {
  const token = getAuthToken();

  if (!token) {
    if (router) router.push('/login');
    return null;
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  // Handle expired/invalid tokens
  if (response.status === 401) {
    clearAuthToken();
    if (router) router.push('/login');
    return null;
  }

  const data = await response.json();
  return { response, data };
}

/**
 * Check if user is authenticated. Use in useEffect on protected pages.
 * Returns the token if valid, or redirects to login and returns null.
 */
export function requireAuth(router: { push: (url: string) => void }): string | null {
  const token = getAuthToken();
  if (!token) {
    router.push('/login');
    return null;
  }
  return token;
}
