'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export type PaymentStatus =
  | 'pending'
  | 'confirming'
  | 'completed'
  | 'expired'
  | 'failed'
  | 'refunded'
  | 'cancelled';

export interface PaymentStatusData {
  id: string;
  status: PaymentStatus;
  confirmations: number;
  requiredConfirmations: number;
  amount: string;
  cryptoAmount: string;
  cryptocurrency: string;
  address: string;
  txHash?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

interface UsePaymentStatusOptions {
  paymentId: string;
  pollingInterval?: number; // in milliseconds
  enabled?: boolean;
  onStatusChange?: (status: PaymentStatus, data: PaymentStatusData) => void;
  onComplete?: (data: PaymentStatusData) => void;
  onError?: (error: Error) => void;
}

interface UsePaymentStatusReturn {
  data: PaymentStatusData | null;
  status: PaymentStatus | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  stopPolling: () => void;
  startPolling: () => void;
}

/**
 * Hook for real-time payment status monitoring using polling
 * 
 * @example
 * ```tsx
 * const { data, status, isLoading } = usePaymentStatus({
 *   paymentId: 'pay_123',
 *   pollingInterval: 5000,
 *   onStatusChange: (status) => console.log('Status changed:', status),
 *   onComplete: (data) => console.log('Payment complete!', data),
 * });
 * ```
 */
export function usePaymentStatus({
  paymentId,
  pollingInterval = 5000,
  enabled = true,
  onStatusChange,
  onComplete,
  onError,
}: UsePaymentStatusOptions): UsePaymentStatusReturn {
  const [data, setData] = useState<PaymentStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isPolling, setIsPolling] = useState(enabled);
  
  const previousStatusRef = useRef<PaymentStatus | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!paymentId) return;

    try {
      const response = await fetch(`/api/payments/${paymentId}`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch payment status: ${response.statusText}`);
      }

      const paymentData: PaymentStatusData = await response.json();
      setData(paymentData);
      setError(null);

      // Check for status change
      if (previousStatusRef.current !== paymentData.status) {
        onStatusChange?.(paymentData.status, paymentData);
        previousStatusRef.current = paymentData.status;
      }

      // Check for completion
      if (paymentData.status === 'completed') {
        onComplete?.(paymentData);
        // Stop polling on completion
        setIsPolling(false);
      }

      // Stop polling on terminal states
      if (['completed', 'expired', 'failed', 'refunded', 'cancelled'].includes(paymentData.status)) {
        setIsPolling(false);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      setError(error);
      onError?.(error);
    } finally {
      setIsLoading(false);
    }
  }, [paymentId, onStatusChange, onComplete, onError]);

  // Initial fetch
  useEffect(() => {
    if (enabled && paymentId) {
      fetchStatus();
    }
  }, [enabled, paymentId, fetchStatus]);

  // Polling
  useEffect(() => {
    if (isPolling && paymentId) {
      intervalRef.current = setInterval(fetchStatus, pollingInterval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPolling, paymentId, pollingInterval, fetchStatus]);

  const stopPolling = useCallback(() => {
    setIsPolling(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    setIsPolling(true);
  }, []);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    await fetchStatus();
  }, [fetchStatus]);

  return {
    data,
    status: data?.status ?? null,
    isLoading,
    error,
    refetch,
    stopPolling,
    startPolling,
  };
}

/**
 * Hook for monitoring multiple payments at once
 */
export function useMultiplePaymentStatus(
  paymentIds: string[],
  options?: Omit<UsePaymentStatusOptions, 'paymentId'>
): Map<string, UsePaymentStatusReturn> {
  const [results, setResults] = useState<Map<string, UsePaymentStatusReturn>>(new Map());

  useEffect(() => {
    const newResults = new Map<string, UsePaymentStatusReturn>();
    
    // This is a simplified implementation
    // In production, you'd want to batch these requests
    paymentIds.forEach((id) => {
      // Note: This is a placeholder - actual implementation would need
      // to properly manage multiple polling instances
      newResults.set(id, {
        data: null,
        status: null,
        isLoading: true,
        error: null,
        refetch: async () => {},
        stopPolling: () => {},
        startPolling: () => {},
      });
    });

    setResults(newResults);
  }, [paymentIds]);

  return results;
}

/**
 * Calculate progress percentage based on confirmations
 */
export function calculateConfirmationProgress(
  confirmations: number,
  requiredConfirmations: number
): number {
  if (requiredConfirmations === 0) return 100;
  return Math.min(100, Math.round((confirmations / requiredConfirmations) * 100));
}

/**
 * Get human-readable status message
 */
export function getStatusMessage(status: PaymentStatus, confirmations?: number, required?: number): string {
  switch (status) {
    case 'pending':
      return 'Waiting for payment...';
    case 'confirming':
      if (confirmations !== undefined && required !== undefined) {
        return `Confirming (${confirmations}/${required} confirmations)`;
      }
      return 'Confirming transaction...';
    case 'completed':
      return 'Payment completed!';
    case 'expired':
      return 'Payment expired';
    case 'failed':
      return 'Payment failed';
    case 'refunded':
      return 'Payment refunded';
    case 'cancelled':
      return 'Payment cancelled';
    default:
      return 'Unknown status';
  }
}

/**
 * Get status color for UI
 */
export function getStatusColor(status: PaymentStatus): string {
  switch (status) {
    case 'pending':
      return 'yellow';
    case 'confirming':
      return 'blue';
    case 'completed':
      return 'green';
    case 'expired':
    case 'failed':
      return 'red';
    case 'refunded':
      return 'orange';
    case 'cancelled':
      return 'gray';
    default:
      return 'gray';
  }
}