'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWebWallet } from '@/components/web-wallet/WalletContext';
import { WalletHeader } from '@/components/web-wallet/WalletHeader';
import { ChainBadge } from '@/components/web-wallet/AddressDisplay';
import { AddressDisplay } from '@/components/web-wallet/AddressDisplay';
import { AmountInput } from '@/components/web-wallet/AmountInput';
import { QRCode } from '@/components/web-wallet/QRCode';
import {
  TransactionList,
  type TransactionItem,
} from '@/components/web-wallet/TransactionList';
import {
  decryptWithPassword,
  loadWalletFromStorage,
} from '@/lib/web-wallet/client-crypto';
import type { WalletChain } from '@/lib/web-wallet/identity';
import { isValidChain } from '@/lib/web-wallet/identity';
import type { TransactionListOptions } from '@/lib/wallet-sdk/types';
import { SUPPORTED_FIAT_CURRENCIES, type FiatCurrency } from '@/lib/web-wallet/settings';
import { LightningSetup } from '@/components/lightning/LightningSetup';
import { LightningOfferCard } from '@/components/lightning/LightningOfferCard';
import { LightningPayments } from '@/components/lightning/LightningPayments';

const EXPLORER_URLS: Record<string, string> = {
  BTC: 'https://blockstream.info/tx/',
  BCH: 'https://blockchair.com/bitcoin-cash/transaction/',
  ETH: 'https://etherscan.io/tx/',
  POL: 'https://polygonscan.com/tx/',
  SOL: 'https://explorer.solana.com/tx/',
  USDC_ETH: 'https://etherscan.io/tx/',
  USDC_POL: 'https://polygonscan.com/tx/',
  USDC_SOL: 'https://explorer.solana.com/tx/',
  XRP: 'https://xrpscan.com/tx/',
  ADA: 'https://cardanoscan.io/transaction/',
};

// ── Constants ──

const CHAIN_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  BCH: 'Bitcoin Cash',
  ETH: 'Ethereum',
  POL: 'Polygon',
  SOL: 'Solana',
  USDC_ETH: 'USDC (Ethereum)',
  USDC_POL: 'USDC (Polygon)',
  USDC_SOL: 'USDC (Solana)',
  XRP: 'XRP',
  ADA: 'Cardano',
};

const CHAIN_SYMBOLS: Record<string, string> = {
  BTC: 'BTC',
  BCH: 'BCH',
  ETH: 'ETH',
  POL: 'POL',
  SOL: 'SOL',
  USDC_ETH: 'USDC',
  USDC_POL: 'USDC',
  USDC_SOL: 'USDC',
  XRP: 'XRP',
  ADA: 'ADA',
};

const CHAIN_WARNINGS: Record<string, string> = {
  BTC: 'Only send Bitcoin (BTC) to this address. Sending other assets will result in permanent loss.',
  BCH: 'Only send Bitcoin Cash (BCH) to this address. BTC and BCH addresses may look similar but are not compatible.',
  ETH: 'Only send Ethereum (ETH) or ERC-20 tokens to this address.',
  POL: 'Only send Polygon (POL) or tokens on the Polygon network to this address. Do not send assets from other networks.',
  SOL: 'Only send Solana (SOL) or SPL tokens to this address.',
  USDC_ETH: 'Only send USDC on Ethereum to this address. USDC on other networks is not compatible.',
  USDC_POL: 'Only send USDC on Polygon to this address. USDC on other networks is not compatible.',
  USDC_SOL: 'Only send USDC on Solana to this address. USDC on other networks is not compatible.',
  XRP: 'Only send XRP to this address. Sending other assets will result in permanent loss.',
  ADA: 'Only send ADA to this address. Sending other assets will result in permanent loss.',
};

type Tab = 'send' | 'receive' | 'history';
type SendStep = 'form' | 'confirm' | 'password' | 'sending' | 'success' | 'error';
type Priority = 'low' | 'medium' | 'high';

interface FeeInfo {
  fee: string;
  feeCurrency: string;
}

interface WalletAddress {
  id: string;
  address: string;
  chain: string;
  index: number;
}

const DEPOSIT_POLL_MS = 10_000;
const TX_POLL_MS = 10_000;
const PAGE_SIZE = 20;

// ── Main Page Component ──

export default function AssetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { isUnlocked, isLoading: walletLoading } = useWebWallet();
  const rawChain = typeof params.chain === 'string' ? params.chain : '';

  useEffect(() => {
    if (!walletLoading && !isUnlocked) {
      router.replace('/web-wallet/unlock');
    }
  }, [isUnlocked, walletLoading, router]);

  if (walletLoading || !isUnlocked) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
      </div>
    );
  }

  if (!rawChain || !isValidChain(rawChain)) {
    return (
      <>
        <WalletHeader />
        <div className="mx-auto max-w-lg px-4 py-16 text-center">
          <h1 className="text-2xl font-bold text-white">Unknown Chain</h1>
          <p className="mt-2 text-sm text-gray-400">
            &quot;{rawChain}&quot; is not a supported chain.
          </p>
          <Link
            href="/web-wallet"
            className="mt-6 inline-block rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </>
    );
  }

  // Lightning Network gets its own dedicated view
  if (rawChain === 'LN') {
    return <LightningAssetView />;
  }

  return <AssetDetailView chain={rawChain} />;
}

// ── Lightning Asset View ──

function LightningAssetView() {
  const { wallet } = useWebWallet();
  const [lnNode, setLnNode] = useState<{ id: string; status: string; node_pubkey: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'offers' | 'payments'>('offers');

  useEffect(() => {
    if (!wallet) return;
    // Check if LN node exists for this wallet
    fetch(`/api/lightning/nodes?wallet_id=${wallet.walletId}`, {
      headers: { 'Authorization': `Bearer ${wallet.walletId}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data?.node) {
          setLnNode(data.data.node);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [wallet]);

  if (loading) {
    return (
      <>
        <WalletHeader />
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
        </div>
      </>
    );
  }

  return (
    <>
      <WalletHeader />
      <div className="mx-auto max-w-lg px-4 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/web-wallet" className="text-gray-400 hover:text-white transition-colors">
            ← Back
          </Link>
          <h1 className="text-2xl font-bold text-white">⚡ Lightning Network</h1>
        </div>

        {!lnNode ? (
          <LightningSetup
            walletId={wallet?.walletId || ''}
            mnemonic={wallet?.getMnemonic() || ''}
            onSetupComplete={(node) => setLnNode(node)}
          />
        ) : (
          <LightningDashboard lnNode={lnNode} />
        )}
      </div>
    </>
  );
}

// ── Lightning Dashboard ──

function LightningDashboard({ lnNode }: { lnNode: { id: string; status: string; node_pubkey: string | null } }) {
  const [activeTab, setActiveTab] = useState<'receive' | 'send' | 'payments'>('receive');
  const [createOfferLoading, setCreateOfferLoading] = useState(false);
  const [newOfferDesc, setNewOfferDesc] = useState('');
  const [newOfferAmount, setNewOfferAmount] = useState('');
  const [payBolt12, setPayBolt12] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payLoading, setPayLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const createOffer = async () => {
    if (!newOfferDesc) {
      setMessage({ type: 'error', text: 'Description is required' });
      return;
    }
    setCreateOfferLoading(true);
    setMessage(null);
    try {
      const resp = await fetch('/api/lightning/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id: lnNode.id,
          description: newOfferDesc,
          amount_msat: newOfferAmount ? parseInt(newOfferAmount) * 1000 : undefined,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        setMessage({ type: 'success', text: 'Offer created! Share it to receive payments.' });
        setNewOfferDesc('');
        setNewOfferAmount('');
      } else {
        setMessage({ type: 'error', text: data.error?.message || 'Failed to create offer' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setCreateOfferLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Node status */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">Node Status</span>
          <span className={`text-sm font-medium ${lnNode.status === 'active' ? 'text-green-400' : 'text-yellow-400'}`}>
            {lnNode.status}
          </span>
        </div>
        {lnNode.node_pubkey && (
          <p className="mt-1 text-xs text-gray-500 font-mono truncate">{lnNode.node_pubkey}</p>
        )}
      </div>

      {/* Message */}
      {message && (
        <div className={`rounded-lg p-3 text-sm ${
          message.type === 'success' ? 'bg-green-900/30 text-green-400 border border-green-800' : 'bg-red-900/30 text-red-400 border border-red-800'
        }`}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {(['receive', 'send', 'payments'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setMessage(null); }}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors capitalize ${
              activeTab === tab
                ? 'bg-purple-600 text-white'
                : 'bg-white/5 text-gray-400 hover:text-white'
            }`}
          >
            {tab === 'receive' ? '⬇ Receive' : tab === 'send' ? '⬆ Send' : '📋 History'}
          </button>
        ))}
      </div>

      {/* Receive Tab */}
      {activeTab === 'receive' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
            <h3 className="text-white font-semibold">Create BOLT12 Offer</h3>
            <p className="text-xs text-gray-400">Create a reusable payment request that anyone can pay.</p>
            <input
              type="text"
              placeholder="What is this for? (e.g. Donation, Payment)"
              value={newOfferDesc}
              onChange={(e) => setNewOfferDesc(e.target.value)}
              className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-2.5 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-purple-500"
            />
            <input
              type="number"
              placeholder="Amount in sats (leave empty for any amount)"
              value={newOfferAmount}
              onChange={(e) => setNewOfferAmount(e.target.value)}
              className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-2.5 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-purple-500"
            />
            <button
              onClick={createOffer}
              disabled={createOfferLoading}
              className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              {createOfferLoading ? 'Creating...' : '⚡ Create Offer'}
            </button>
          </div>

          {/* Existing offers */}
          <div>
            <h3 className="text-white font-semibold mb-3">Your Offers</h3>
            <LightningOfferCard nodeId={lnNode.id} />
          </div>
        </div>
      )}

      {/* Send Tab */}
      {activeTab === 'send' && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
          <h3 className="text-white font-semibold">Pay a BOLT12 Offer</h3>
          <p className="text-xs text-gray-400">Paste a BOLT12 offer or invoice to send a payment.</p>
          <textarea
            placeholder="Paste BOLT12 offer (lno1...) or invoice (lnbc...)"
            value={payBolt12}
            onChange={(e) => setPayBolt12(e.target.value)}
            rows={3}
            className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-2.5 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-purple-500 font-mono"
          />
          <input
            type="number"
            placeholder="Amount in sats (if offer is any-amount)"
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
            className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-2.5 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-purple-500"
          />
          <button
            onClick={async () => {
              if (!payBolt12) {
                setMessage({ type: 'error', text: 'Paste an offer or invoice' });
                return;
              }
              setPayLoading(true);
              setMessage(null);
              try {
                const resp = await fetch('/api/lightning/payments', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    node_id: lnNode.id,
                    bolt12: payBolt12,
                    amount_sats: payAmount ? parseInt(payAmount) : undefined,
                  }),
                });
                const data = await resp.json();
                if (data.success) {
                  setMessage({ type: 'success', text: 'Payment sent!' });
                  setPayBolt12('');
                  setPayAmount('');
                } else {
                  setMessage({ type: 'error', text: data.error?.message || 'Payment failed' });
                }
              } catch {
                setMessage({ type: 'error', text: 'Network error' });
              } finally {
                setPayLoading(false);
              }
            }}
            disabled={payLoading}
            className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
          >
            {payLoading ? 'Sending...' : '⚡ Send Payment'}
          </button>
        </div>
      )}

      {/* Payments Tab */}
      {activeTab === 'payments' && (
        <LightningPayments nodeId={lnNode.id} />
      )}
    </div>
  );
}

// ── Asset Detail View ──

function AssetDetailView({ chain }: { chain: WalletChain }) {
  const { wallet } = useWebWallet();
  const [activeTab, setActiveTab] = useState<Tab>('send');
  const [totalBalance, setTotalBalance] = useState('0');
  const [usdValue, setUsdValue] = useState(0);
  const [loadingBalance, setLoadingBalance] = useState(true);

  const fetchBalance = useCallback(async () => {
    if (!wallet) return;
    setLoadingBalance(true);
    try {
      const data = await wallet.getTotalBalanceUSD();
      const chainBalances = data.balances.filter((b) => b.chain === chain);
      const total = chainBalances.reduce((sum, b) => sum + parseFloat(b.balance), 0);
      const usd = chainBalances.reduce((sum, b) => sum + b.usdValue, 0);
      setTotalBalance(total > 0 ? total.toString() : '0');
      setUsdValue(usd);
    } catch (err: unknown) {
      console.error('Failed to fetch chain balance:', err);
    } finally {
      setLoadingBalance(false);
    }
  }, [wallet, chain]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  const chainName = CHAIN_NAMES[chain] || chain;
  const chainSymbol = CHAIN_SYMBOLS[chain] || chain;

  const tabs: { id: Tab; label: string; color: string }[] = [
    { id: 'send', label: 'Send', color: 'purple' },
    { id: 'receive', label: 'Receive', color: 'green' },
    { id: 'history', label: 'History', color: 'blue' },
  ];

  return (
    <>
      <WalletHeader />
      <div className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        {/* Back link */}
        <Link
          href="/web-wallet"
          className="inline-flex items-center text-sm text-gray-400 hover:text-gray-200 transition-colors"
        >
          &larr; Dashboard
        </Link>

        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-br from-purple-600/20 to-pink-600/20 border border-purple-500/20 p-6">
          <div className="flex items-center gap-3 mb-4">
            <ChainBadge chain={chain} />
            <h1 className="text-2xl font-bold text-white">{chainName}</h1>
          </div>
          {loadingBalance ? (
            <div className="space-y-2">
              <div className="h-10 w-48 bg-white/10 rounded-lg animate-pulse" />
              <div className="h-5 w-24 bg-white/10 rounded-lg animate-pulse" />
            </div>
          ) : (
            <>
              <p className="text-3xl font-bold text-white">
                {totalBalance} {chainSymbol}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                ≈ ${usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
              </p>
            </>
          )}
        </div>

        {/* Tabs */}
        <div className="flex rounded-xl border border-white/10 bg-white/5 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'send' && (
          <SendTab chain={chain} onSuccess={fetchBalance} onSwitchToReceive={() => setActiveTab('receive')} />
        )}
        {activeTab === 'receive' && (
          <ReceiveTab chain={chain} />
        )}
        {activeTab === 'history' && (
          <HistoryTab chain={chain} />
        )}
      </div>
    </>
  );
}

// ── Send Tab ──

function SendTab({ chain, onSuccess, onSwitchToReceive }: { chain: WalletChain; onSuccess: () => void; onSwitchToReceive: () => void }) {
  const router = useRouter();
  const { wallet } = useWebWallet();

  const [step, setStep] = useState<SendStep>('form');
  const [fromAddress, setFromAddress] = useState('');
  const [addresses, setAddresses] = useState<WalletAddress[]>([]);
  const [loadingAddrs, setLoadingAddrs] = useState(false);
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [fees, setFees] = useState<Record<Priority, FeeInfo> | null>(null);
  const [loadingFees, setLoadingFees] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');
  const [addressError, setAddressError] = useState('');
  const [amountError, setAmountError] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [txStatus, setTxStatus] = useState<'pending' | 'confirming' | 'confirmed' | 'failed'>('pending');
  const [txConfirmations, setTxConfirmations] = useState(0);
  const txPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Dual input system state
  const [fiatCurrency, setFiatCurrency] = useState<FiatCurrency>('USD');
  const [fiatAmount, setFiatAmount] = useState('');
  const [cryptoAmount, setCryptoAmount] = useState('');
  const [primaryInput, setPrimaryInput] = useState<'fiat' | 'crypto'>('fiat'); // Which input is editable
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState('');
  const debounceRef = useRef<NodeJS.Timeout>();

  const chainSymbol = CHAIN_SYMBOLS[chain] || chain;

  const priorityLabels: Record<Priority, string> = {
    low: 'Slow',
    medium: 'Standard',
    high: 'Fast',
  };

  // Fetch exchange rate
  const fetchRate = useCallback(async (chain: string, fiat: string) => {
    if (!chain || !fiat) return;
    
    setRateLoading(true);
    setRateError('');
    
    try {
      const response = await fetch(`/api/rates?coin=${chain}&fiat=${fiat}`);
      const data = await response.json();
      
      if (data.success && data.rate) {
        setExchangeRate(data.rate);
      } else {
        setRateError('Failed to fetch exchange rate');
        setExchangeRate(null);
      }
    } catch (error) {
      setRateError('Failed to fetch exchange rate');
      setExchangeRate(null);
    } finally {
      setRateLoading(false);
    }
  }, []);

  // Debounced rate fetching
  const debouncedFetchRate = useCallback((chain: string, fiat: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      fetchRate(chain, fiat);
    }, 300);
  }, [fetchRate]);

  // Calculate crypto amount from fiat
  const calculateCryptoFromFiat = useCallback((fiatValue: string) => {
    if (!fiatValue || !exchangeRate || exchangeRate === 0) {
      setCryptoAmount('');
      return;
    }
    const fiatNum = parseFloat(fiatValue);
    if (isNaN(fiatNum) || fiatNum < 0) {
      setCryptoAmount('');
      return;
    }
    const cryptoValue = fiatNum / exchangeRate;
    setCryptoAmount(cryptoValue.toString());
  }, [exchangeRate]);

  // Calculate fiat amount from crypto
  const calculateFiatFromCrypto = useCallback((cryptoValue: string) => {
    if (!cryptoValue || !exchangeRate) {
      setFiatAmount('');
      return;
    }
    const cryptoNum = parseFloat(cryptoValue);
    if (isNaN(cryptoNum) || cryptoNum < 0) {
      setFiatAmount('');
      return;
    }
    const fiatValue = cryptoNum * exchangeRate;
    setFiatAmount(fiatValue.toFixed(2));
  }, [exchangeRate]);

  // Handle fiat input change
  const handleFiatChange = (value: string) => {
    setFiatAmount(value);
    if (primaryInput === 'fiat') {
      calculateCryptoFromFiat(value);
    }
  };

  // Handle crypto input change
  const handleCryptoChange = (value: string) => {
    setCryptoAmount(value);
    if (primaryInput === 'crypto') {
      calculateFiatFromCrypto(value);
    }
  };

  // Toggle primary input
  const togglePrimaryInput = () => {
    const newPrimary = primaryInput === 'fiat' ? 'crypto' : 'fiat';
    setPrimaryInput(newPrimary);
    
    // Recalculate based on new primary
    if (newPrimary === 'fiat' && fiatAmount) {
      calculateCryptoFromFiat(fiatAmount);
    } else if (newPrimary === 'crypto' && cryptoAmount) {
      calculateFiatFromCrypto(cryptoAmount);
    }
  };

  // Fetch rate when chain or fiat currency changes
  useEffect(() => {
    if (chain && fiatCurrency) {
      debouncedFetchRate(chain, fiatCurrency);
    }
  }, [chain, fiatCurrency, debouncedFetchRate]);

  // Update form amount when crypto amount changes
  useEffect(() => {
    setAmount(cryptoAmount);
  }, [cryptoAmount]);

  // Fetch addresses for this chain
  const fetchAddresses = useCallback(async () => {
    if (!wallet) return;
    setLoadingAddrs(true);
    try {
      const data = await wallet.getAddresses({ chain });
      const mapped = data.map((a) => ({
        id: a.addressId,
        address: a.address,
        chain: a.chain,
        index: a.derivationIndex ?? 0,
      }));
      setAddresses(mapped);
      if (mapped.length > 0) {
        setFromAddress(mapped[0].address);
      } else {
        setFromAddress('');
      }
    } catch (err: unknown) {
      console.error('Failed to fetch addresses:', err);
      setAddresses([]);
      setFromAddress('');
    } finally {
      setLoadingAddrs(false);
    }
  }, [wallet, chain]);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  // Fetch fees
  const fetchFees = useCallback(async () => {
    if (!wallet) return;
    setLoadingFees(true);
    try {
      const estimate = await wallet.estimateFee(chain);
      setFees({
        low: { fee: estimate.low.fee, feeCurrency: estimate.low.feeCurrency },
        medium: { fee: estimate.medium.fee, feeCurrency: estimate.medium.feeCurrency },
        high: { fee: estimate.high.fee, feeCurrency: estimate.high.feeCurrency },
      });
    } catch (err: unknown) {
      console.error('Failed to fetch fee estimates:', err);
      setFees(null);
    } finally {
      setLoadingFees(false);
    }
  }, [wallet, chain]);

  useEffect(() => {
    fetchFees();
  }, [fetchFees]);

  const validateForm = (): boolean => {
    let valid = true;
    if (!fromAddress) {
      valid = false;
    }
    if (!toAddress.trim()) {
      setAddressError('Address is required');
      valid = false;
    } else {
      setAddressError('');
    }
    if (!cryptoAmount || parseFloat(cryptoAmount) <= 0) {
      setAmountError('Amount must be greater than 0');
      valid = false;
    } else {
      setAmountError('');
    }
    return valid;
  };

  const handleReview = () => {
    if (!validateForm()) return;
    setStep('confirm');
  };

  const handleConfirmSend = () => {
    setPassword('');
    setPasswordError('');
    setStep('password');
  };

  const handleSend = async () => {
    if (!wallet) return;
    setStep('sending');
    setError('');
    try {
      const result = await wallet.send({
        chain,
        fromAddress,
        toAddress: toAddress.trim(),
        amount,
        priority,
      });
      setTxHash(result.txHash);
      setStep('success');
      onSuccess();
    } catch (err: unknown) {
      console.error('Send transaction failed:', err);
      setError(err instanceof Error ? err.message : 'Transaction failed');
      setStep('error');
    }
  };

  const handlePasswordSubmit = async () => {
    if (!password) {
      setPasswordError('Password is required');
      return;
    }
    const stored = loadWalletFromStorage();
    if (!stored) {
      setPasswordError('Wallet data not found');
      return;
    }
    const result = await decryptWithPassword(stored.encrypted, password);
    if (!result) {
      setPasswordError('Incorrect password');
      return;
    }
    setPassword('');
    await handleSend();
  };

  // Poll tx status after success
  useEffect(() => {
    if (step !== 'success' || !wallet || !txHash) return;

    const pollTxStatus = async () => {
      try {
        const txData = await wallet.getTransactions({
          limit: 5,
          direction: 'outgoing',
        });
        const tx = txData.transactions.find((t) => t.txHash === txHash);
        if (tx) {
          setTxStatus(tx.status as typeof txStatus);
          setTxConfirmations(tx.confirmations);
          if (tx.status === 'confirmed') {
            if (txPollRef.current) {
              clearInterval(txPollRef.current);
              txPollRef.current = null;
            }
          }
        }
      } catch (err: unknown) {
        console.error('Failed to poll tx status:', err);
      }
    };

    pollTxStatus();
    txPollRef.current = setInterval(pollTxStatus, TX_POLL_MS);

    return () => {
      if (txPollRef.current) {
        clearInterval(txPollRef.current);
        txPollRef.current = null;
      }
    };
  }, [step, wallet, txHash]);

  const resetForm = () => {
    setStep('form');
    setToAddress('');
    setAmount('');
    setPriority('medium');
    setTxHash('');
    setError('');
    setAddressError('');
    setAmountError('');
    setPassword('');
    setPasswordError('');
    setTxStatus('pending');
    setTxConfirmations(0);
    // Reset dual input state
    setFiatAmount('');
    setCryptoAmount('');
    setPrimaryInput('fiat');
    setExchangeRate(null);
    setRateError('');
  };

  // ── Render steps ──

  if (step === 'form') {
    return (
      <div className="space-y-6">
        {/* From address selector */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-300">
            From Address
          </label>
          {loadingAddrs ? (
            <div className="h-12 rounded-lg bg-white/5 animate-pulse" aria-busy="true" />
          ) : addresses.length > 0 ? (
            <select
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value)}
              aria-label="From address"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white font-mono text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 appearance-none"
            >
              {addresses.map((a) => (
                <option key={a.id} value={a.address} className="bg-slate-900">
                  {a.address.slice(0, 12)}...{a.address.slice(-8)}
                </option>
              ))}
            </select>
          ) : (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3" role="alert">
              <p className="text-xs text-yellow-400">
                No {chain} addresses found.{' '}
                <button
                  onClick={onSwitchToReceive}
                  className="underline hover:text-yellow-300"
                >
                  Derive one first
                </button>
              </p>
            </div>
          )}
        </div>

        {/* Recipient */}
        <div className="space-y-2">
          <label htmlFor="asset-recipient-address" className="block text-sm font-medium text-gray-300">
            Recipient Address
          </label>
          <input
            id="asset-recipient-address"
            type="text"
            value={toAddress}
            onChange={(e) => {
              setToAddress(e.target.value);
              setAddressError('');
            }}
            placeholder="Enter recipient address"
            className={`w-full rounded-lg border bg-white/5 px-4 py-3 text-white placeholder-gray-500 font-mono text-sm focus:outline-none focus:ring-1 ${
              addressError
                ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                : 'border-white/10 focus:border-purple-500 focus:ring-purple-500'
            }`}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!addressError}
            aria-describedby={addressError ? 'asset-address-error' : undefined}
          />
          {addressError && (
            <p id="asset-address-error" className="text-xs text-red-400" role="alert">{addressError}</p>
          )}
        </div>

        {/* Dual Amount Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Amount *
          </label>
          
          {/* Fiat Currency Selector */}
          <div className="mb-3">
            <select
              value={fiatCurrency}
              onChange={(e) => setFiatCurrency(e.target.value as FiatCurrency)}
              className="w-32 px-3 py-1 text-sm border border-white/10 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white/5 text-white"
            >
              {SUPPORTED_FIAT_CURRENCIES.map((currency) => (
                <option key={currency.code} value={currency.code} className="bg-slate-900">
                  {currency.code} ({currency.symbol})
                </option>
              ))}
            </select>
          </div>

          {/* Dual Input Container */}
          <div className="space-y-3">
            {/* Fiat Input */}
            <div className="relative">
              <div className="flex items-center">
                <span className="text-sm text-gray-500 dark:text-gray-400 w-12">
                  {SUPPORTED_FIAT_CURRENCIES.find(c => c.code === fiatCurrency)?.symbol}
                </span>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={fiatAmount}
                  onChange={(e) => {
                    handleFiatChange(e.target.value);
                    setAmountError('');
                  }}
                  disabled={primaryInput !== 'fiat'}
                  className="flex-1 px-4 py-2 border border-white/10 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white/5 text-white placeholder-gray-500 disabled:bg-white/10 disabled:text-gray-500"
                  placeholder={`0.00 ${fiatCurrency}`}
                />
              </div>
              {primaryInput === 'fiat' && (
                <span className="absolute right-3 top-2.5 text-sm text-purple-400">Primary</span>
              )}
            </div>

            {/* Toggle Button */}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={togglePrimaryInput}
                className="p-2 text-gray-500 hover:text-purple-400 dark:text-gray-400 dark:hover:text-purple-400 transition-colors"
                title="Switch primary input"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </button>
            </div>

            {/* Crypto Input */}
            <div className="relative">
              <div className="flex items-center">
                <span className="text-sm text-gray-500 dark:text-gray-400 w-12">
                  {chainSymbol}
                </span>
                <input
                  type="number"
                  step="any"
                  min="0.000001"
                  data-testid="amount-field"
                  value={cryptoAmount}
                  onChange={(e) => {
                    handleCryptoChange(e.target.value);
                    setAmountError('');
                  }}
                  disabled={primaryInput !== 'crypto'}
                  className="flex-1 px-4 py-2 border border-white/10 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white/5 text-white placeholder-gray-500 disabled:bg-white/10 disabled:text-gray-500"
                  placeholder={`0.000000 ${chainSymbol}`}
                />
              </div>
              {primaryInput === 'crypto' && (
                <span className="absolute right-3 top-2.5 text-sm text-purple-400">Primary</span>
              )}
            </div>
          </div>

          {/* Exchange Rate Display */}
          <div className="mt-2 text-sm text-gray-400">
            {rateLoading ? (
              <span>Loading exchange rate...</span>
            ) : rateError ? (
              <span className="text-red-400">{rateError}</span>
            ) : exchangeRate ? (
              <span>
                1 {chainSymbol} = {SUPPORTED_FIAT_CURRENCIES.find(c => c.code === fiatCurrency)?.symbol}{exchangeRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} {fiatCurrency}
              </span>
            ) : null}
          </div>

          {amountError && (
            <p className="text-xs text-red-400 mt-1">{amountError}</p>
          )}
        </div>

        {/* Fee selector */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-300">
            Transaction Speed
          </label>
          {loadingFees ? (
            <div className="h-16 rounded-lg bg-white/5 animate-pulse" aria-busy="true" />
          ) : (
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Transaction speed">
              {(['low', 'medium', 'high'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={priority === level}
                  onClick={() => setPriority(level)}
                  className={`rounded-lg border p-3 text-center transition-colors ${
                    priority === level
                      ? 'border-purple-500 bg-purple-500/10 text-white'
                      : 'border-white/10 bg-white/5 text-gray-400 hover:border-white/20'
                  }`}
                >
                  <p className="text-xs font-medium">{priorityLabels[level]}</p>
                  {fees && (
                    <p className="mt-1 text-[10px] text-gray-400">
                      {fees[level].fee} {fees[level].feeCurrency}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={handleReview}
          disabled={!fromAddress || !toAddress || !cryptoAmount}
          className="w-full rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Review Transaction
        </button>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Confirm Transaction</h2>
          <div className="space-y-3">
            <ConfirmRow label="Chain" value={CHAIN_NAMES[chain] || chain} />
            <ConfirmRow label="From" value={`${fromAddress.slice(0, 10)}...${fromAddress.slice(-6)}`} mono />
            <ConfirmRow label="To" value={`${toAddress.slice(0, 10)}...${toAddress.slice(-6)}`} mono />
            <ConfirmRow label="Amount" value={`${cryptoAmount} ${chainSymbol}`} />
            <ConfirmRow label="Speed" value={priorityLabels[priority]} />
            {fees && (
              <ConfirmRow label="Est. Fee" value={`${fees[priority].fee} ${fees[priority].feeCurrency}`} />
            )}
          </div>
        </div>

        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4" role="alert">
          <p className="text-xs text-yellow-400">
            Please verify the address carefully. Transactions cannot be reversed.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setStep('form')}
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm text-gray-300 hover:bg-white/10 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={handleConfirmSend}
            className="flex-1 rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors"
          >
            Send Now
          </button>
        </div>
      </div>
    );
  }

  if (step === 'password') {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Enter Password</h2>
          <p className="text-sm text-gray-400">
            Enter your wallet password to authorize this transaction.
          </p>
          <div className="space-y-2">
            <label htmlFor="asset-send-password" className="block text-sm font-medium text-gray-300">
              Password
            </label>
            <input
              id="asset-send-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePasswordSubmit();
              }}
              placeholder="Enter your password"
              className={`w-full rounded-lg border bg-white/5 px-4 py-3 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-1 ${
                passwordError
                  ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                  : 'border-white/10 focus:border-purple-500 focus:ring-purple-500'
              }`}
              autoFocus
              aria-invalid={!!passwordError}
              aria-describedby={passwordError ? 'asset-password-error' : undefined}
            />
            {passwordError && (
              <p id="asset-password-error" className="text-xs text-red-400" role="alert">{passwordError}</p>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => {
              setPassword('');
              setPasswordError('');
              setStep('confirm');
            }}
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm text-gray-300 hover:bg-white/10 transition-colors"
          >
            Back
          </button>
          <button
            onClick={handlePasswordSubmit}
            disabled={!password}
            className="flex-1 rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Authorize &amp; Send
          </button>
        </div>
      </div>
    );
  }

  if (step === 'sending') {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4" aria-busy="true">
        <div className="h-12 w-12 animate-spin rounded-full border-3 border-purple-500 border-t-transparent" />
        <p className="text-sm text-gray-400">Signing &amp; broadcasting...</p>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="space-y-6 text-center py-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
          <svg className="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Transaction Sent</h2>
          <p className="mt-1 text-sm text-gray-400">
            {cryptoAmount} {chainSymbol} sent successfully
          </p>
        </div>

        {/* Live tx status */}
        <div className="flex items-center justify-center gap-2">
          <TxStatusBadge status={txStatus} confirmations={txConfirmations} />
        </div>

        {txHash && (
          <p className="text-xs text-gray-400 font-mono break-all">TX: {txHash}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={resetForm}
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm text-gray-300 hover:bg-white/10 transition-colors"
          >
            Send Another
          </button>
          <a
            href={`${EXPLORER_URLS[chain] || '/web-wallet'}${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-xl bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors text-center"
          >
            View on Explorer ↗
          </a>
        </div>
      </div>
    );
  }

  // step === 'error'
  return (
    <div className="space-y-6 text-center py-8">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20">
        <svg className="h-8 w-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <div>
        <h2 className="text-xl font-bold text-white">Transaction Failed</h2>
        <p className="mt-2 text-sm text-red-400">{error}</p>
      </div>
      <button
        onClick={resetForm}
        className="rounded-xl bg-purple-600 px-8 py-3 text-sm font-semibold text-white hover:bg-purple-500 transition-colors"
      >
        Try Again
      </button>
    </div>
  );
}

// ── Receive Tab ──

function ReceiveTab({ chain }: { chain: WalletChain }) {
  const router = useRouter();
  const { wallet } = useWebWallet();

  const [addresses, setAddresses] = useState<WalletAddress[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeriving, setIsDeriving] = useState(false);
  const [error, setError] = useState('');
  const [deposit, setDeposit] = useState<{ address: string; amount: string } | null>(null);
  const [redirectCountdown, setRedirectCountdown] = useState(0);

  const balancesRef = useRef<Map<string, string>>(new Map());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const chainSymbol = CHAIN_SYMBOLS[chain] || chain;

  const fetchAddresses = useCallback(async () => {
    if (!wallet) return;
    setIsLoading(true);
    try {
      const data = await wallet.getAddresses({ chain });
      setAddresses(
        data.map((a) => ({
          id: a.addressId,
          chain: a.chain,
          address: a.address,
          index: a.derivationIndex ?? 0,
        }))
      );
    } catch (err: unknown) {
      console.error('Failed to fetch addresses:', err);
      setAddresses([]);
    } finally {
      setIsLoading(false);
    }
  }, [wallet, chain]);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  // Initialize baseline balances
  const initializeBalances = useCallback(async () => {
    if (!wallet || addresses.length === 0) return;
    try {
      const balances = await wallet.getBalances({ chain, refresh: true });
      const map = new Map<string, string>();
      for (const b of balances) {
        const key = `${b.chain}:${b.address}`;
        map.set(key, b.balance);
      }
      balancesRef.current = map;
    } catch (err: unknown) {
      console.error('Failed to initialize balances:', err);
    }
  }, [wallet, addresses, chain]);

  useEffect(() => {
    initializeBalances();
  }, [initializeBalances]);

  // Poll for deposits
  const checkForDeposits = useCallback(async () => {
    if (!wallet || addresses.length === 0 || deposit) return;
    try {
      const balances = await wallet.getBalances({ chain, refresh: true });
      for (const b of balances) {
        const key = `${b.chain}:${b.address}`;
        const previous = balancesRef.current.get(key);
        if (previous !== undefined) {
          const prevAmount = parseFloat(previous);
          const newAmount = parseFloat(b.balance);
          if (newAmount > prevAmount && newAmount > 0) {
            const depositAmount = (newAmount - prevAmount).toString();
            console.log(`[AssetReceive] Deposit detected: ${depositAmount} ${b.chain} at ${b.address.slice(0, 8)}...${b.address.slice(-4)}`);
            setDeposit({ address: b.address, amount: depositAmount });
            return;
          }
        }
        balancesRef.current.set(key, b.balance);
      }
    } catch (err: unknown) {
      console.error('Deposit check failed:', err);
    }
  }, [wallet, addresses, chain, deposit]);

  useEffect(() => {
    if (addresses.length === 0 || deposit) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(checkForDeposits, DEPOSIT_POLL_MS);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [addresses, checkForDeposits, deposit]);

  // Redirect countdown after deposit
  useEffect(() => {
    if (!deposit) return;
    const REDIRECT_DELAY_MS = 4_000;
    const seconds = Math.ceil(REDIRECT_DELAY_MS / 1000);
    setRedirectCountdown(seconds);

    const countdownInterval = setInterval(() => {
      setRedirectCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const redirectTimer = setTimeout(() => {
      router.push('/web-wallet');
    }, REDIRECT_DELAY_MS);

    return () => {
      clearInterval(countdownInterval);
      clearTimeout(redirectTimer);
    };
  }, [deposit, router]);

  const handleDeriveAddress = async () => {
    if (!wallet) return;
    setIsDeriving(true);
    setError('');
    try {
      await wallet.deriveAddress(chain);
      await fetchAddresses();
    } catch (err: unknown) {
      console.error('Failed to derive address:', err);
      setError(err instanceof Error ? err.message : 'Failed to derive address');
    } finally {
      setIsDeriving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Deposit detected banner */}
      {deposit && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 animate-pulse" role="alert">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-500/20">
              <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-green-400">Deposit Received!</p>
              <p className="text-xs text-green-300/80">+{deposit.amount} {chainSymbol}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Redirecting to dashboard in {redirectCountdown}s...
          </p>
        </div>
      )}

      {/* Polling indicator */}
      {!deposit && addresses.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          Watching for incoming deposits...
        </div>
      )}

      {/* Chain warning */}
      {CHAIN_WARNINGS[chain] && !deposit && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3" role="alert">
          <p className="text-xs text-yellow-400">{CHAIN_WARNINGS[chain]}</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Address list */}
      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading addresses">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-white/5 bg-white/5 p-4 animate-pulse">
              <div className="h-4 w-24 rounded bg-white/10 mb-2" />
              <div className="h-5 w-full rounded bg-white/10" />
            </div>
          ))}
        </div>
      ) : addresses.length > 0 ? (
        <div className="space-y-3">
          {addresses.map((addr) => (
            <div
              key={addr.id}
              className={`rounded-xl border p-4 transition-colors ${
                deposit?.address === addr.address
                  ? 'border-green-500/30 bg-green-500/5'
                  : 'border-white/5 bg-white/5'
              }`}
            >
              <AddressDisplay
                address={addr.address}
                chain={addr.chain}
                label={`Index ${addr.index}`}
                truncate={false}
              />
              <div className="mt-3 flex items-center justify-center">
                <QRCode value={addr.address} size={180} label={`${chain} address`} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-white/5 bg-white/5 p-8 text-center">
          <p className="text-sm text-gray-400">No {chain} addresses yet</p>
          <p className="mt-1 text-xs text-gray-400">Derive an address to get started</p>
        </div>
      )}

      {/* Derive button */}
      {!deposit && (
        <button
          onClick={handleDeriveAddress}
          disabled={isDeriving}
          aria-busy={isDeriving}
          className="w-full rounded-xl border border-purple-500/30 bg-purple-500/10 px-6 py-3 text-sm font-medium text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
        >
          {isDeriving
            ? 'Deriving...'
            : addresses.length > 0
              ? `Generate Additional ${chain} Address`
              : `Generate ${chain} Address`}
        </button>
      )}
    </div>
  );
}

// ── History Tab ──

function HistoryTab({ chain }: { chain: WalletChain }) {
  const { wallet } = useWebWallet();

  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ newTxs: number; error?: string } | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const hasSyncedRef = useRef(false);

  const fetchTransactions = useCallback(async () => {
    if (!wallet) return;
    setIsLoading(true);
    try {
      const opts: TransactionListOptions = {
        chain,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      };
      const data = await wallet.getTransactions(opts);
      const mapped = data.transactions.map((tx): TransactionItem => ({
        id: tx.id,
        txHash: tx.txHash || tx.id,
        chain: tx.chain,
        type: tx.direction === 'outgoing' ? 'send' : 'receive',
        amount: tx.amount,
        status: (tx.status === 'confirming' ? 'pending' : tx.status) as 'pending' | 'confirmed' | 'failed',
        fromAddress: tx.fromAddress,
        toAddress: tx.toAddress,
        createdAt: tx.createdAt,
      }));

      if (page === 0) {
        setTransactions(mapped);
      } else {
        setTransactions((prev) => [...prev, ...mapped]);
      }
      setHasMore(mapped.length === PAGE_SIZE);
    } catch (err: unknown) {
      console.error('Failed to fetch transactions:', err);
      if (page === 0) setTransactions([]);
    } finally {
      setIsLoading(false);
    }
  }, [wallet, chain, page]);

  const doSync = useCallback(async () => {
    if (!wallet || isSyncing) return;
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const result = await wallet.syncHistory(chain);
      setSyncResult({ newTxs: result.newTransactions });
      // Clear sync result after 5 seconds
      setTimeout(() => setSyncResult(null), 5000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      console.error('History sync failed:', err);
      setSyncResult({ newTxs: 0, error: msg });
    } finally {
      setIsSyncing(false);
      fetchTransactions();
    }
  }, [wallet, chain, isSyncing, fetchTransactions]);

  // Sync on-chain history once when the tab first renders, then fetch transactions
  useEffect(() => {
    if (!wallet || hasSyncedRef.current) {
      fetchTransactions();
      return;
    }

    hasSyncedRef.current = true;
    doSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, chain]);

  // Fetch transactions when page changes (after initial sync)
  useEffect(() => {
    if (page > 0) {
      fetchTransactions();
    }
  }, [page, fetchTransactions]);

  return (
    <div className="space-y-4">
      {/* Sync Status Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isSyncing ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
              <span className="text-xs text-blue-400">Syncing blockchain...</span>
            </>
          ) : syncResult ? (
            syncResult.error ? (
              <span className="text-xs text-red-400">⚠ {syncResult.error}</span>
            ) : (
              <span className="text-xs text-green-400">
                ✓ Synced {syncResult.newTxs} new transaction{syncResult.newTxs !== 1 ? 's' : ''}
              </span>
            )
          ) : null}
        </div>
        <button
          onClick={doSync}
          disabled={isSyncing}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-400 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
        >
          <svg
            className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Sync
        </button>
      </div>

      <TransactionList
        transactions={transactions}
        isLoading={isLoading && page === 0 && !isSyncing}
        emptyMessage={`No ${chain} transactions yet. Tap Sync to check the blockchain.`}
      />

      {hasMore && !isLoading && (
        <div className="text-center">
          <button
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg bg-white/5 px-6 py-2 text-sm text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            Load more
          </button>
        </div>
      )}

      {isLoading && page > 0 && (
        <div className="flex justify-center" aria-busy="true">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
        </div>
      )}
    </div>
  );
}

// ── Shared Sub-components ──

function ConfirmRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-400">{label}</span>
      <span className={`text-sm text-white ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function TxStatusBadge({ status, confirmations }: { status: string; confirmations: number }) {
  const confirmText = `${confirmations} ${confirmations === 1 ? 'confirmation' : 'confirmations'}`;

  if (status === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 border border-green-500/30 px-3 py-1 text-xs font-medium text-green-400">
        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
        Confirmed ({confirmText})
      </span>
    );
  }
  if (status === 'confirming') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/30 px-3 py-1 text-xs font-medium text-yellow-400">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400" />
        </span>
        Confirming... ({confirmText})
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/30 px-3 py-1 text-xs font-medium text-red-400">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        Failed
      </span>
    );
  }
  // pending
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-500/10 border border-purple-500/30 px-3 py-1 text-xs font-medium text-purple-400">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-purple-400" />
      </span>
      Pending...
    </span>
  );
}
