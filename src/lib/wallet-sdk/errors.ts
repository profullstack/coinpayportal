/**
 * Wallet SDK Error Classes
 *
 * Typed error hierarchy that maps API error codes to specific exceptions.
 */

import type { ApiError } from './types';

export class WalletSDKError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    statusCode: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WalletSDKError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class AuthenticationError extends WalletSDKError {
  constructor(
    message: string = 'Authentication failed',
    code: string = 'UNAUTHORIZED',
    details?: Record<string, unknown>
  ) {
    super(code, message, 401, details);
    this.name = 'AuthenticationError';
  }
}

export class InsufficientFundsError extends WalletSDKError {
  constructor(
    message: string = 'Insufficient funds',
    details?: Record<string, unknown>
  ) {
    super('INSUFFICIENT_FUNDS', message, 400, details);
    this.name = 'InsufficientFundsError';
  }
}

export class InvalidAddressError extends WalletSDKError {
  constructor(
    message: string = 'Invalid address format',
    details?: Record<string, unknown>
  ) {
    super('INVALID_ADDRESS', message, 400, details);
    this.name = 'InvalidAddressError';
  }
}

export class NetworkError extends WalletSDKError {
  public readonly cause?: Error;

  constructor(message: string = 'Network request failed', cause?: Error) {
    super('NETWORK_ERROR', message, 0);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

export class RateLimitError extends WalletSDKError {
  public readonly retryAfter: number;

  constructor(retryAfter: number, message?: string) {
    super(
      'RATE_LIMIT_EXCEEDED',
      message || `Rate limited. Retry after ${retryAfter}s`,
      429,
      { retry_after: retryAfter }
    );
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class TransactionExpiredError extends WalletSDKError {
  constructor(message: string = 'Prepared transaction has expired') {
    super('TX_EXPIRED', message, 400);
    this.name = 'TransactionExpiredError';
  }
}

/**
 * Map an API error response to the appropriate typed error.
 */
export function mapApiError(
  statusCode: number,
  error: ApiError
): WalletSDKError {
  switch (error.code) {
    case 'UNAUTHORIZED':
    case 'INVALID_SIGNATURE':
    case 'AUTH_EXPIRED':
      return new AuthenticationError(error.message, error.code, error.details);
    case 'INVALID_ADDRESS':
      return new InvalidAddressError(error.message, error.details);
    case 'INSUFFICIENT_FUNDS':
      return new InsufficientFundsError(error.message, error.details);
    case 'RATE_LIMIT_EXCEEDED':
      return new RateLimitError(
        (error.details?.retry_after as number) || 60,
        error.message
      );
    case 'TX_EXPIRED':
      return new TransactionExpiredError(error.message);
    default:
      return new WalletSDKError(
        error.code,
        error.message,
        statusCode,
        error.details
      );
  }
}
