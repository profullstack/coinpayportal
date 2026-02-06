/**
 * Web Wallet API Response Helpers
 *
 * Standard response format for all web-wallet endpoints:
 * { success, data, error, timestamp }
 */

import { NextResponse } from 'next/server';

interface WalletApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export function walletSuccess(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    {
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}

export function walletError(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>
) {
  const error: WalletApiError = { code, message };
  if (details) error.details = details;

  return NextResponse.json(
    {
      success: false,
      data: null,
      error,
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}

/** Common error responses */
export const WalletErrors = {
  unauthorized: (msg = 'Missing or invalid authentication') =>
    walletError('UNAUTHORIZED', msg, 401),
  invalidSignature: (msg = 'Signature verification failed') =>
    walletError('INVALID_SIGNATURE', msg, 401),
  authExpired: (msg = 'Auth token or challenge expired') =>
    walletError('AUTH_EXPIRED', msg, 401),
  forbidden: (msg = 'Action not allowed') =>
    walletError('FORBIDDEN', msg, 403),
  notFound: (resource: string) =>
    walletError(`${resource.toUpperCase()}_NOT_FOUND`, `${resource} not found`, 404),
  invalidAddress: (msg = 'Invalid blockchain address format') =>
    walletError('INVALID_ADDRESS', msg, 400),
  invalidChain: (msg = 'Unsupported blockchain') =>
    walletError('INVALID_CHAIN', msg, 400),
  badRequest: (code: string, msg: string, details?: Record<string, unknown>) =>
    walletError(code, msg, 400, details),
  rateLimited: (retryAfter: number) =>
    walletError('RATE_LIMIT_EXCEEDED', 'Too many requests. Please try again later.', 429, {
      retry_after: retryAfter,
    }),
  serverError: (msg = 'Internal server error') =>
    walletError('INTERNAL_ERROR', msg, 500),
  configError: () =>
    walletError('INTERNAL_ERROR', 'Server configuration error', 500),
};
