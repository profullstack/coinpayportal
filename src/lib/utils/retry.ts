/**
 * Retry Utility for HTTP Requests
 * 
 * Provides fetch with automatic retry logic using exponential backoff.
 * Retries on transient errors (404, 429, 5xx) but not on client errors (400, 401, 403).
 */

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff (default: 100) */
  baseDelayMs: number;
}

/**
 * Default retry configuration
 */
const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 100,
};

/**
 * HTTP status codes that should trigger a retry
 * - 404: Not Found (can be transient in distributed systems)
 * - 408: Request Timeout
 * - 429: Too Many Requests
 * - 500: Internal Server Error
 * - 502: Bad Gateway
 * - 503: Service Unavailable
 * - 504: Gateway Timeout
 */
const RETRYABLE_STATUS_CODES = new Set([404, 408, 429, 500, 502, 503, 504]);

/**
 * HTTP status codes that should NOT trigger a retry (client errors)
 * - 400: Bad Request
 * - 401: Unauthorized
 * - 403: Forbidden
 */
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403]);

/**
 * Custom error class for retry exhaustion
 */
export class RetryError extends Error {
  public readonly attempts: number;
  public readonly lastStatus: number | undefined;
  public readonly lastError: Error | undefined;

  constructor(
    message: string,
    attempts: number,
    lastStatus?: number,
    lastError?: Error
  ) {
    super(message);
    this.name = 'RetryError';
    this.attempts = attempts;
    this.lastStatus = lastStatus;
    this.lastError = lastError;
  }
}

/**
 * Delay execution for a specified number of milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay for a given attempt using exponential backoff
 * Delay = baseDelayMs * 2^(attempt - 1)
 * 
 * @param attempt - Current attempt number (1-indexed)
 * @param baseDelayMs - Base delay in milliseconds
 * @returns Delay in milliseconds
 */
function calculateDelay(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * Math.pow(2, attempt - 1);
}

/**
 * Check if a status code should trigger a retry
 */
function isRetryableStatus(status: number): boolean {
  if (NON_RETRYABLE_STATUS_CODES.has(status)) {
    return false;
  }
  return RETRYABLE_STATUS_CODES.has(status);
}

/**
 * Fetch with automatic retry logic using exponential backoff
 * 
 * @param url - URL to fetch
 * @param options - Fetch options (method, headers, body, etc.)
 * @param config - Retry configuration
 * @returns Response from successful fetch
 * @throws RetryError if all retries are exhausted
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  config: RetryConfig = DEFAULT_CONFIG
): Promise<Response> {
  const { maxRetries, baseDelayMs } = config;
  
  let lastStatus: number | undefined;
  let lastError: Error | undefined;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // If response is OK, return it
      if (response.ok) {
        return response;
      }
      
      // If status is non-retryable, return the response as-is
      if (!isRetryableStatus(response.status)) {
        return response;
      }
      
      // Store last status for error reporting
      lastStatus = response.status;
      
      // If this is the last attempt, throw error
      if (attempt === maxRetries) {
        throw new RetryError(
          `Request failed after ${maxRetries} attempts with status ${response.status}`,
          attempt,
          lastStatus
        );
      }
      
      // Calculate delay and wait before retrying
      const delayMs = calculateDelay(attempt, baseDelayMs);
      console.log(
        `[Retry] Attempt ${attempt}/${maxRetries} failed with status ${response.status}, ` +
        `retrying in ${delayMs}ms...`
      );
      await delay(delayMs);
      
    } catch (error) {
      // If it's already a RetryError, rethrow it
      if (error instanceof RetryError) {
        throw error;
      }
      
      // Store last error for error reporting
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // If this is the last attempt, throw RetryError
      if (attempt === maxRetries) {
        throw new RetryError(
          `Request failed after ${maxRetries} attempts: ${lastError.message}`,
          attempt,
          lastStatus,
          lastError
        );
      }
      
      // Calculate delay and wait before retrying
      const delayMs = calculateDelay(attempt, baseDelayMs);
      console.log(
        `[Retry] Attempt ${attempt}/${maxRetries} failed with error: ${lastError.message}, ` +
        `retrying in ${delayMs}ms...`
      );
      await delay(delayMs);
    }
  }
  
  // This should never be reached, but TypeScript needs it
  throw new RetryError(
    `Request failed after ${maxRetries} attempts`,
    maxRetries,
    lastStatus,
    lastError
  );
}
