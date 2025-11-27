'use client';

import { useEffect, useState } from 'react';
import {
  usePaymentStatus,
  PaymentStatus,
  PaymentStatusData,
  calculateConfirmationProgress,
  getStatusMessage,
  getStatusColor,
} from '@/lib/payments/usePaymentStatus';
import { PAYMENT_EXPIRATION_MINUTES } from '@/lib/payments/service';

interface PaymentStatusCardProps {
  paymentId: string;
  onComplete?: (data: PaymentStatusData) => void;
  onExpired?: () => void;
  showQR?: boolean;
  compact?: boolean;
}

export function PaymentStatusCard({
  paymentId,
  onComplete,
  onExpired,
  showQR = true,
  compact = false,
}: PaymentStatusCardProps) {
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  const { data, status, isLoading, error, refetch } = usePaymentStatus({
    paymentId,
    pollingInterval: 5000,
    onComplete,
    onStatusChange: (newStatus) => {
      if (newStatus === 'expired') {
        onExpired?.();
      }
    },
  });

  // Countdown timer based on expires_at from payment data
  useEffect(() => {
    if (data && status === 'pending') {
      // Use expires_at if available, otherwise calculate from createdAt
      const expiryTime = data.expiresAt
        ? new Date(data.expiresAt).getTime()
        : new Date(data.createdAt).getTime() + PAYMENT_EXPIRATION_MINUTES * 60 * 1000;
      
      const updateTimer = () => {
        const remaining = Math.max(0, Math.floor((expiryTime - Date.now()) / 1000));
        setTimeLeft(remaining);
        if (remaining === 0) {
          onExpired?.();
        }
      };
      updateTimer();
      const interval = setInterval(updateTimer, 1000);
      return () => clearInterval(interval);
    }
  }, [data, status, onExpired]);

  const handleCopyAddress = () => {
    if (data?.address) {
      navigator.clipboard.writeText(data.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const statusColors: Record<string, { bg: string; text: string; dot: string }> = {
    yellow: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', dot: 'bg-yellow-400' },
    blue: { bg: 'bg-blue-500/20', text: 'text-blue-400', dot: 'bg-blue-400' },
    green: { bg: 'bg-green-500/20', text: 'text-green-400', dot: 'bg-green-400' },
    red: { bg: 'bg-red-500/20', text: 'text-red-400', dot: 'bg-red-400' },
    orange: { bg: 'bg-orange-500/20', text: 'text-orange-400', dot: 'bg-orange-400' },
    gray: { bg: 'bg-gray-500/20', text: 'text-gray-400', dot: 'bg-gray-400' },
  };

  if (isLoading && !data) {
    return (
      <div className={`bg-slate-800/50 rounded-2xl border border-white/10 ${compact ? 'p-4' : 'p-6'}`}>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-slate-800/50 rounded-2xl border border-red-500/50 ${compact ? 'p-4' : 'p-6'}`}>
        <div className="text-center py-4">
          <div className="text-red-400 mb-2">Failed to load payment</div>
          <button
            onClick={() => refetch()}
            className="text-sm text-purple-400 hover:text-purple-300"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const color = getStatusColor(status!);
  const colorClasses = statusColors[color] || statusColors.gray;
  const progress = calculateConfirmationProgress(data.confirmations, data.requiredConfirmations);

  return (
    <div className={`bg-slate-800/50 rounded-2xl border border-white/10 overflow-hidden ${compact ? '' : ''}`}>
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 px-6 py-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${colorClasses.dot} animate-pulse`} />
            <span className={`text-sm font-medium ${colorClasses.text}`}>
              {getStatusMessage(status!, data.confirmations, data.requiredConfirmations)}
            </span>
          </div>
          {timeLeft !== null && status === 'pending' && (
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className={`text-sm font-mono font-semibold ${
                timeLeft < 60 ? 'text-red-400 animate-pulse' :
                timeLeft < 180 ? 'text-orange-400' :
                'text-gray-300'
              }`}>
                {formatTime(timeLeft)}
              </span>
            </div>
          )}
        </div>
        
        {/* Time warning banner */}
        {timeLeft !== null && status === 'pending' && timeLeft < 180 && timeLeft > 0 && (
          <div className={`mt-3 p-2 rounded-lg text-xs text-center ${
            timeLeft < 60 ? 'bg-red-500/20 text-red-300' : 'bg-orange-500/20 text-orange-300'
          }`}>
            {timeLeft < 60
              ? '⚠️ Less than 1 minute remaining! Send payment now.'
              : `⏰ Only ${Math.ceil(timeLeft / 60)} minutes left to complete payment`
            }
          </div>
        )}
      </div>

      {/* Content */}
      <div className={compact ? 'p-4' : 'p-6'}>
        {/* Amount */}
        <div className="text-center mb-6">
          <div className="text-3xl font-bold text-white mb-1">
            {data.cryptoAmount} {data.cryptocurrency}
          </div>
          <div className="text-sm text-gray-400">
            ≈ {data.amount}
          </div>
        </div>

        {/* Progress bar for confirming status */}
        {status === 'confirming' && (
          <div className="mb-6">
            <div className="flex justify-between text-sm text-gray-400 mb-2">
              <span>Confirmations</span>
              <span>{data.confirmations}/{data.requiredConfirmations}</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Time limit notice */}
        {status === 'pending' && timeLeft !== null && timeLeft > 180 && (
          <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-blue-300">
                <span className="font-medium">You have {PAYMENT_EXPIRATION_MINUTES} minutes</span> to complete this payment.
                After that, the payment will expire and you&apos;ll need to create a new one.
              </div>
            </div>
          </div>
        )}

        {/* Address */}
        {status === 'pending' && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Send exactly <span className="text-white font-semibold">{data.cryptoAmount} {data.cryptocurrency}</span> to this address
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 p-3 bg-slate-700/50 rounded-xl text-sm text-gray-300 font-mono truncate">
                {data.address}
              </div>
              <button
                onClick={handleCopyAddress}
                className="p-3 bg-slate-700/50 rounded-xl hover:bg-slate-700 transition-all"
              >
                {copied ? (
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        )}

        {/* QR Code */}
        {showQR && status === 'pending' && !compact && (
          <div className="flex justify-center mb-6">
            <div className="w-40 h-40 bg-white rounded-xl flex items-center justify-center">
              {/* In production, use actual QR code from API */}
              <img
                src={`/api/payments/${paymentId}/qr`}
                alt="Payment QR Code"
                className="w-full h-full rounded-xl"
                onError={(e) => {
                  // Fallback if QR fails to load
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          </div>
        )}

        {/* Transaction hash */}
        {data.txHash && (
          <div className="p-4 bg-slate-700/30 rounded-xl">
            <div className="text-sm text-gray-400 mb-1">Transaction Hash</div>
            <div className="text-sm text-white font-mono truncate">{data.txHash}</div>
          </div>
        )}

        {/* Success state */}
        {status === 'completed' && (
          <div className="text-center py-4">
            <div className="w-16 h-16 mx-auto bg-green-500/20 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-lg font-semibold text-white">Payment Complete!</div>
          </div>
        )}

        {/* Expired state */}
        {status === 'expired' && (
          <div className="text-center py-4">
            <div className="w-16 h-16 mx-auto bg-red-500/20 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="text-lg font-semibold text-white mb-2">Payment Expired</div>
            <div className="text-sm text-gray-400 mb-4">
              The {PAYMENT_EXPIRATION_MINUTES}-minute payment window has passed.
            </div>
            <div className="text-xs text-gray-500">
              No funds were received. Please create a new payment to try again.
            </div>
          </div>
        )}

        {/* Cancelled state */}
        {status === 'cancelled' && (
          <div className="text-center py-4">
            <div className="w-16 h-16 mx-auto bg-gray-500/20 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div className="text-lg font-semibold text-white mb-2">Payment Cancelled</div>
            <div className="text-sm text-gray-400">This payment has been cancelled</div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Compact payment status indicator for lists
 */
export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const color = getStatusColor(status);
  const statusColors: Record<string, { bg: string; text: string }> = {
    yellow: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
    blue: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
    green: { bg: 'bg-green-500/20', text: 'text-green-400' },
    red: { bg: 'bg-red-500/20', text: 'text-red-400' },
    orange: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
    gray: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
  };
  const colorClasses = statusColors[color] || statusColors.gray;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClasses.bg} ${colorClasses.text}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}