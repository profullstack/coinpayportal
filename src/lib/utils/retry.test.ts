import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry, RetryConfig, RetryError } from './retry';

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('successful requests', () => {
    it('should return response on first successful attempt', async () => {
      const mockResponse = new Response(JSON.stringify({ data: 'test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

      vi.mocked(fetch).mockResolvedValueOnce(mockResponse);

      const result = await fetchWithRetry('https://api.example.com/test');

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should pass through request options', async () => {
      const mockResponse = new Response('{}', { status: 200 });
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse);

      const options: RequestInit = {
        method: 'POST',
        headers: { 'x-api-key': 'test-key' },
        body: JSON.stringify({ test: true }),
      };

      await fetchWithRetry('https://api.example.com/test', options);

      expect(fetch).toHaveBeenCalledWith('https://api.example.com/test', options);
    });
  });

  describe('retry behavior', () => {
    it('should retry on 404 error and succeed on second attempt', async () => {
      const failResponse = new Response('Not Found', { status: 404 });
      const successResponse = new Response('{}', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(successResponse);

      const fetchPromise = fetchWithRetry('https://api.example.com/test');

      // Advance timer for first retry delay
      await vi.advanceTimersByTimeAsync(100);

      const result = await fetchPromise;

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 500 error and succeed on third attempt', async () => {
      const failResponse1 = new Response('Server Error', { status: 500 });
      const failResponse2 = new Response('Server Error', { status: 500 });
      const successResponse = new Response('{}', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(failResponse1)
        .mockResolvedValueOnce(failResponse2)
        .mockResolvedValueOnce(successResponse);

      const fetchPromise = fetchWithRetry('https://api.example.com/test');

      // Advance timers for retry delays
      await vi.advanceTimersByTimeAsync(100); // First retry
      await vi.advanceTimersByTimeAsync(200); // Second retry

      const result = await fetchPromise;

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('should retry on network error and succeed on second attempt', async () => {
      const successResponse = new Response('{}', { status: 200 });

      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(successResponse);

      const fetchPromise = fetchWithRetry('https://api.example.com/test');

      await vi.advanceTimersByTimeAsync(100);

      const result = await fetchPromise;

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw RetryError after all retries exhausted', async () => {
      const failResponse = new Response('Not Found', { status: 404 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(failResponse);

      // Attach catch handler immediately to prevent unhandled rejection
      let caughtError: unknown;
      const fetchPromise = fetchWithRetry('https://api.example.com/test').catch((error) => {
        caughtError = error;
      });

      // Advance timers for all retry delays
      await vi.advanceTimersByTimeAsync(100); // First retry
      await vi.advanceTimersByTimeAsync(200); // Second retry

      // Wait for the promise to settle
      await fetchPromise;

      expect(caughtError).toBeInstanceOf(RetryError);
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('should include attempt count in RetryError', async () => {
      const failResponse = new Response('Not Found', { status: 404 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(failResponse);

      // Attach catch handler immediately to prevent unhandled rejection
      let caughtError: unknown;
      const fetchPromise = fetchWithRetry('https://api.example.com/test').catch((error) => {
        caughtError = error;
      });

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);

      // Wait for the promise to settle
      await fetchPromise;

      expect(caughtError).toBeInstanceOf(RetryError);
      expect((caughtError as RetryError).attempts).toBe(3);
      expect((caughtError as RetryError).lastStatus).toBe(404);
    });
  });

  describe('custom configuration', () => {
    it('should respect custom maxRetries', async () => {
      const failResponse = new Response('Error', { status: 500 });
      const successResponse = new Response('{}', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(successResponse);

      const config: RetryConfig = { maxRetries: 5, baseDelayMs: 50 };
      const fetchPromise = fetchWithRetry('https://api.example.com/test', {}, config);

      // Advance timers for all retries
      await vi.advanceTimersByTimeAsync(50);  // 1st retry
      await vi.advanceTimersByTimeAsync(100); // 2nd retry
      await vi.advanceTimersByTimeAsync(200); // 3rd retry
      await vi.advanceTimersByTimeAsync(400); // 4th retry

      const result = await fetchPromise;

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(5);
    });

    it('should respect custom baseDelayMs', async () => {
      const failResponse = new Response('Error', { status: 500 });
      const successResponse = new Response('{}', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(successResponse);

      const config: RetryConfig = { maxRetries: 3, baseDelayMs: 200 };
      const fetchPromise = fetchWithRetry('https://api.example.com/test', {}, config);

      // Should not resolve before delay
      await vi.advanceTimersByTimeAsync(100);
      expect(fetch).toHaveBeenCalledTimes(1);

      // Should resolve after delay
      await vi.advanceTimersByTimeAsync(100);
      const result = await fetchPromise;

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('exponential backoff', () => {
    it('should use exponential backoff for delays', async () => {
      const failResponse = new Response('Error', { status: 500 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(failResponse);

      const config: RetryConfig = { maxRetries: 3, baseDelayMs: 100 };
      
      // Attach catch handler immediately to prevent unhandled rejection
      let caughtError: unknown;
      const fetchPromise = fetchWithRetry('https://api.example.com/test', {}, config).catch((error) => {
        caughtError = error;
      });

      // First retry after 100ms (100 * 2^0)
      await vi.advanceTimersByTimeAsync(100);
      expect(fetch).toHaveBeenCalledTimes(2);

      // Second retry after 200ms (100 * 2^1)
      await vi.advanceTimersByTimeAsync(200);
      expect(fetch).toHaveBeenCalledTimes(3);

      // Wait for the promise to settle
      await fetchPromise;

      expect(caughtError).toBeInstanceOf(RetryError);
    });
  });

  describe('non-retryable status codes', () => {
    it('should not retry on 400 Bad Request', async () => {
      const failResponse = new Response('Bad Request', { status: 400 });

      vi.mocked(fetch).mockResolvedValueOnce(failResponse);

      const result = await fetchWithRetry('https://api.example.com/test');

      expect(result.status).toBe(400);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 401 Unauthorized', async () => {
      const failResponse = new Response('Unauthorized', { status: 401 });

      vi.mocked(fetch).mockResolvedValueOnce(failResponse);

      const result = await fetchWithRetry('https://api.example.com/test');

      expect(result.status).toBe(401);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 403 Forbidden', async () => {
      const failResponse = new Response('Forbidden', { status: 403 });

      vi.mocked(fetch).mockResolvedValueOnce(failResponse);

      const result = await fetchWithRetry('https://api.example.com/test');

      expect(result.status).toBe(403);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('retryable status codes', () => {
    it('should retry on 404 Not Found', async () => {
      const failResponse = new Response('Not Found', { status: 404 });
      const successResponse = new Response('{}', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(successResponse);

      const fetchPromise = fetchWithRetry('https://api.example.com/test');

      await vi.advanceTimersByTimeAsync(100);

      const result = await fetchPromise;

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 429 Too Many Requests', async () => {
      const failResponse = new Response('Too Many Requests', { status: 429 });
      const successResponse = new Response('{}', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(successResponse);

      const fetchPromise = fetchWithRetry('https://api.example.com/test');

      await vi.advanceTimersByTimeAsync(100);

      const result = await fetchPromise;

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 502 Bad Gateway', async () => {
      const failResponse = new Response('Bad Gateway', { status: 502 });
      const successResponse = new Response('{}', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(successResponse);

      const fetchPromise = fetchWithRetry('https://api.example.com/test');

      await vi.advanceTimersByTimeAsync(100);

      const result = await fetchPromise;

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 503 Service Unavailable', async () => {
      const failResponse = new Response('Service Unavailable', { status: 503 });
      const successResponse = new Response('{}', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(successResponse);

      const fetchPromise = fetchWithRetry('https://api.example.com/test');

      await vi.advanceTimersByTimeAsync(100);

      const result = await fetchPromise;

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 504 Gateway Timeout', async () => {
      const failResponse = new Response('Gateway Timeout', { status: 504 });
      const successResponse = new Response('{}', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(successResponse);

      const fetchPromise = fetchWithRetry('https://api.example.com/test');

      await vi.advanceTimersByTimeAsync(100);

      const result = await fetchPromise;

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });
});
