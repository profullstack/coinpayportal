'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export type PaymentStatus = 
  | 'pending'
  | 'detected'
  | 'confirming'
  | 'completed'
  | 'expired'
  | 'failed'
  | 'refunded';

export interface RealtimePayment {
  id: string;
  status: PaymentStatus;
  amount_crypto: string;
  amount_usd: string;
  currency: string;
  payment_address: string;
  confirmations?: number;
  required_confirmations?: number;
  tx_hash?: string;
  created_at: string;
  updated_at: string;
}

export interface PaymentEvent {
  type: 'payment_created' | 'payment_updated' | 'payment_completed' | 'payment_expired';
  payment: RealtimePayment;
  timestamp: string;
}

interface UseRealtimePaymentsOptions {
  businessId?: string;
  enabled?: boolean;
  onPaymentCreated?: (payment: RealtimePayment) => void;
  onPaymentUpdated?: (payment: RealtimePayment) => void;
  onPaymentCompleted?: (payment: RealtimePayment) => void;
  onPaymentExpired?: (payment: RealtimePayment) => void;
  onError?: (error: Error) => void;
}

interface UseRealtimePaymentsReturn {
  payments: RealtimePayment[];
  isConnected: boolean;
  error: Error | null;
  reconnect: () => void;
}

/**
 * Hook for real-time payment updates using Server-Sent Events (SSE)
 * 
 * @example
 * ```tsx
 * const { payments, isConnected } = useRealtimePayments({
 *   businessId: 'biz_123',
 *   onPaymentCompleted: (payment) => {
 *     toast.success(`Payment ${payment.id} completed!`);
 *   },
 * });
 * ```
 */
export function useRealtimePayments({
  businessId,
  enabled = true,
  onPaymentCreated,
  onPaymentUpdated,
  onPaymentCompleted,
  onPaymentExpired,
  onError,
}: UseRealtimePaymentsOptions = {}): UseRealtimePaymentsReturn {
  const [payments, setPayments] = useState<RealtimePayment[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000;

  const connect = useCallback(() => {
    if (!enabled) return;

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      // Build SSE URL with optional business filter
      let url = '/api/realtime/payments';
      if (businessId) {
        url += `?businessId=${businessId}`;
      }

      // Get auth token
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      if (token) {
        url += `${businessId ? '&' : '?'}token=${token}`;
      }

      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      eventSource.onmessage = (event) => {
        try {
          const data: PaymentEvent = JSON.parse(event.data);
          
          switch (data.type) {
            case 'payment_created':
              setPayments((prev) => [data.payment, ...prev]);
              onPaymentCreated?.(data.payment);
              break;
              
            case 'payment_updated':
              setPayments((prev) =>
                prev.map((p) => (p.id === data.payment.id ? data.payment : p))
              );
              onPaymentUpdated?.(data.payment);
              break;
              
            case 'payment_completed':
              setPayments((prev) =>
                prev.map((p) => (p.id === data.payment.id ? data.payment : p))
              );
              onPaymentCompleted?.(data.payment);
              break;
              
            case 'payment_expired':
              setPayments((prev) =>
                prev.map((p) => (p.id === data.payment.id ? data.payment : p))
              );
              onPaymentExpired?.(data.payment);
              break;
          }
        } catch (err) {
          console.error('Failed to parse SSE message:', err);
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);
        eventSource.close();
        
        // Attempt reconnection with exponential backoff
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
          reconnectAttemptsRef.current += 1;
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          const err = new Error('Failed to connect to real-time updates after multiple attempts');
          setError(err);
          onError?.(err);
        }
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to establish SSE connection');
      setError(error);
      onError?.(error);
    }
  }, [enabled, businessId, onPaymentCreated, onPaymentUpdated, onPaymentCompleted, onPaymentExpired, onError]);

  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  return {
    payments,
    isConnected,
    error,
    reconnect,
  };
}

/**
 * Hook for real-time updates on a single payment
 */
export function useRealtimePayment(
  paymentId: string,
  options?: Omit<UseRealtimePaymentsOptions, 'businessId'>
): {
  payment: RealtimePayment | null;
  isConnected: boolean;
  error: Error | null;
} {
  const [payment, setPayment] = useState<RealtimePayment | null>(null);
  
  const { isConnected, error } = useRealtimePayments({
    ...options,
    onPaymentUpdated: (p) => {
      if (p.id === paymentId) {
        setPayment(p);
        options?.onPaymentUpdated?.(p);
      }
    },
    onPaymentCompleted: (p) => {
      if (p.id === paymentId) {
        setPayment(p);
        options?.onPaymentCompleted?.(p);
      }
    },
  });

  return {
    payment,
    isConnected,
    error,
  };
}

/**
 * Connection status indicator component helper
 */
export function getConnectionStatusColor(isConnected: boolean): string {
  return isConnected ? 'green' : 'red';
}

export function getConnectionStatusText(isConnected: boolean): string {
  return isConnected ? 'Connected' : 'Disconnected';
}