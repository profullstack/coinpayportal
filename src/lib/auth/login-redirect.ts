const LOGIN_ORIGIN = 'https://coinpayportal.invalid';

export function getSafeLoginRedirect(value: string | null): string | null {
  const candidate = value?.trim();
  if (
    !candidate ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.includes('\\')
  ) {
    return null;
  }

  try {
    const parsed = new URL(candidate, LOGIN_ORIGIN);
    if (parsed.origin !== LOGIN_ORIGIN) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
