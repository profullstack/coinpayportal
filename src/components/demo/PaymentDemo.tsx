'use client';

import { useState, useEffect } from 'react';

interface DemoPayment {
  id: string;
  amount: number;
  currency: string;
  cryptoAmount: string;
  cryptoCurrency: string;
  address: string;
  status: 'pending' | 'confirming' | 'completed' | 'expired';
  expiresAt: Date;
}

const DEMO_CRYPTOS = [
  { symbol: 'ETH', name: 'Ethereum', icon: '⟠', rate: 3500 },
  { symbol: 'MATIC', name: 'Polygon', icon: '⬡', rate: 0.85 },
  { symbol: 'SOL', name: 'Solana', icon: '◎', rate: 180 },
  { symbol: 'BTC', name: 'Bitcoin', icon: '₿', rate: 95000 },
];

export function PaymentDemo() {
  const [step, setStep] = useState<'amount' | 'crypto' | 'payment' | 'success'>('amount');
  const [amount, setAmount] = useState('25.00');
  const [selectedCrypto, setSelectedCrypto] = useState(DEMO_CRYPTOS[0]);
  const [payment, setPayment] = useState<DemoPayment | null>(null);
  const [timeLeft, setTimeLeft] = useState(900); // 15 minutes
  const [copied, setCopied] = useState(false);

  // Countdown timer
  useEffect(() => {
    if (step === 'payment' && timeLeft > 0) {
      const timer = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [step, timeLeft]);

  // Simulate payment confirmation
  useEffect(() => {
    if (step === 'payment' && payment) {
      // Simulate payment detection after 5 seconds
      const detectTimer = setTimeout(() => {
        setPayment((prev) => prev ? { ...prev, status: 'confirming' } : null);
      }, 5000);

      // Simulate payment completion after 10 seconds
      const completeTimer = setTimeout(() => {
        setPayment((prev) => prev ? { ...prev, status: 'completed' } : null);
        setStep('success');
      }, 10000);

      return () => {
        clearTimeout(detectTimer);
        clearTimeout(completeTimer);
      };
    }
  }, [step, payment]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const calculateCryptoAmount = () => {
    const fiatAmount = parseFloat(amount) || 0;
    return (fiatAmount / selectedCrypto.rate).toFixed(8);
  };

  const generateDemoAddress = () => {
    if (selectedCrypto.symbol === 'SOL') {
      return 'DemoSo1anaAddress' + Math.random().toString(36).substring(2, 15);
    }
    if (selectedCrypto.symbol === 'BTC') {
      return 'bc1qDemo' + Math.random().toString(36).substring(2, 20);
    }
    return '0xDemo' + Math.random().toString(36).substring(2, 15) + 'Address';
  };

  const handleCreatePayment = () => {
    const newPayment: DemoPayment = {
      id: 'demo_' + Math.random().toString(36).substring(2, 9),
      amount: parseFloat(amount),
      currency: 'USD',
      cryptoAmount: calculateCryptoAmount(),
      cryptoCurrency: selectedCrypto.symbol,
      address: generateDemoAddress(),
      status: 'pending',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };
    setPayment(newPayment);
    setStep('payment');
    setTimeLeft(900);
  };

  const handleCopyAddress = () => {
    if (payment) {
      navigator.clipboard.writeText(payment.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleReset = () => {
    setStep('amount');
    setPayment(null);
    setAmount('25.00');
    setSelectedCrypto(DEMO_CRYPTOS[0]);
    setTimeLeft(900);
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 px-6 py-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Live Demo</h3>
            <span className="px-2 py-1 text-xs font-medium bg-green-500/20 text-green-400 rounded-full">
              Testnet
            </span>
          </div>
          <p className="text-sm text-gray-400 mt-1">
            Experience the payment flow
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'amount' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Payment Amount (USD)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full pl-8 pr-4 py-3 bg-slate-700/50 border border-white/10 rounded-xl text-white text-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="0.00"
                    min="1"
                    step="0.01"
                  />
                </div>
              </div>

              <button
                onClick={() => setStep('crypto')}
                disabled={!amount || parseFloat(amount) <= 0}
                className="w-full py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-purple-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          )}

          {step === 'crypto' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">
                  Select Cryptocurrency
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {DEMO_CRYPTOS.map((crypto) => (
                    <button
                      key={crypto.symbol}
                      onClick={() => setSelectedCrypto(crypto)}
                      className={`p-4 rounded-xl border transition-all ${
                        selectedCrypto.symbol === crypto.symbol
                          ? 'border-purple-500 bg-purple-500/20'
                          : 'border-white/10 bg-slate-700/30 hover:border-white/30'
                      }`}
                    >
                      <div className="text-2xl mb-1">{crypto.icon}</div>
                      <div className="text-sm font-medium text-white">{crypto.symbol}</div>
                      <div className="text-xs text-gray-400">{crypto.name}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-slate-700/30 rounded-xl">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">You pay</span>
                  <span className="text-white font-medium">${amount} USD</span>
                </div>
                <div className="flex justify-between text-sm mt-2">
                  <span className="text-gray-400">You send</span>
                  <span className="text-white font-medium">
                    {calculateCryptoAmount()} {selectedCrypto.symbol}
                  </span>
                </div>
                <div className="flex justify-between text-sm mt-2">
                  <span className="text-gray-400">Platform fee</span>
                  <span className="text-green-400 font-medium">0.5%</span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('amount')}
                  className="flex-1 py-3 bg-slate-700/50 text-white font-semibold rounded-xl hover:bg-slate-700 transition-all"
                >
                  Back
                </button>
                <button
                  onClick={handleCreatePayment}
                  className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-purple-500/50 transition-all"
                >
                  Create Payment
                </button>
              </div>
            </div>
          )}

          {step === 'payment' && payment && (
            <div className="space-y-6">
              {/* Timer */}
              <div className="text-center">
                <div className="text-sm text-gray-400 mb-1">Time remaining</div>
                <div className={`text-2xl font-mono font-bold ${timeLeft < 60 ? 'text-red-400' : 'text-white'}`}>
                  {formatTime(timeLeft)}
                </div>
              </div>

              {/* Status */}
              <div className="flex items-center justify-center gap-2">
                {payment.status === 'pending' && (
                  <>
                    <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                    <span className="text-yellow-400 text-sm">Waiting for payment</span>
                  </>
                )}
                {payment.status === 'confirming' && (
                  <>
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                    <span className="text-blue-400 text-sm">Confirming transaction</span>
                  </>
                )}
              </div>

              {/* Amount */}
              <div className="text-center p-4 bg-slate-700/30 rounded-xl">
                <div className="text-3xl font-bold text-white mb-1">
                  {payment.cryptoAmount} {payment.cryptoCurrency}
                </div>
                <div className="text-sm text-gray-400">
                  ≈ ${payment.amount.toFixed(2)} USD
                </div>
              </div>

              {/* Address */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Send to this address
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 p-3 bg-slate-700/50 rounded-xl text-sm text-gray-300 font-mono truncate">
                    {payment.address}
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

              {/* QR Code Placeholder */}
              <div className="flex justify-center">
                <div className="w-40 h-40 bg-white rounded-xl flex items-center justify-center">
                  <div className="text-center text-gray-500 text-xs">
                    <svg className="w-16 h-16 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                    QR Code
                  </div>
                </div>
              </div>

              {/* Sign up prompt */}
              <div className="text-center p-4 bg-purple-500/10 rounded-xl border border-purple-500/30">
                <p className="text-sm text-gray-300 mb-2">
                  Want to accept crypto payments?
                </p>
                <a
                  href="/signup"
                  className="text-purple-400 hover:text-purple-300 font-medium text-sm"
                >
                  Create a free account →
                </a>
              </div>

              <button
                onClick={handleReset}
                className="w-full py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel Payment
              </button>
            </div>
          )}

          {step === 'success' && payment && (
            <div className="space-y-6 text-center">
              <div className="w-20 h-20 mx-auto bg-green-500/20 rounded-full flex items-center justify-center">
                <svg className="w-10 h-10 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <div>
                <h4 className="text-xl font-bold text-white mb-2">Payment Complete!</h4>
                <p className="text-gray-400">
                  Successfully received {payment.cryptoAmount} {payment.cryptoCurrency}
                </p>
              </div>

              <div className="p-4 bg-slate-700/30 rounded-xl text-left">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">Payment ID</span>
                  <span className="text-white font-mono">{payment.id}</span>
                </div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">Amount</span>
                  <span className="text-white">${payment.amount.toFixed(2)} USD</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Status</span>
                  <span className="text-green-400">Completed</span>
                </div>
              </div>

              {/* Sign up CTA */}
              <div className="p-4 bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-xl border border-purple-500/30">
                <p className="text-white font-medium mb-2">
                  Ready to accept crypto payments?
                </p>
                <a
                  href="/signup"
                  className="inline-block px-6 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-lg hover:shadow-lg hover:shadow-purple-500/50 transition-all"
                >
                  Get Started Free
                </a>
              </div>

              <button
                onClick={handleReset}
                className="w-full py-3 bg-slate-700/50 text-white font-semibold rounded-xl hover:bg-slate-700 transition-all"
              >
                Try Another Payment
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}