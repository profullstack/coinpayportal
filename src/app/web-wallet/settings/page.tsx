'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWebWallet } from '@/components/web-wallet/WalletContext';
import { WalletHeader } from '@/components/web-wallet/WalletHeader';
import { PasswordInput } from '@/components/web-wallet/PasswordInput';
import { SeedDisplay } from '@/components/web-wallet/SeedDisplay';
import { ChainBadge } from '@/components/web-wallet/AddressDisplay';
import { downloadEncryptedSeedPhrase } from '@/lib/web-wallet/seedphrase-backup';
import { SUPPORTED_FIAT_CURRENCIES, type FiatCurrency } from '@/lib/web-wallet/settings';

interface WalletSettings {
  walletId: string;
  dailySpendLimit: number | null;
  whitelistAddresses: string[];
  whitelistEnabled: boolean;
  requireConfirmation: boolean;
  confirmationDelaySeconds: number;
  displayCurrency: FiatCurrency;
}

export default function SettingsPage() {
  const router = useRouter();
  const { wallet, walletId, chains, isUnlocked, deleteWallet, lock, changePassword, refreshChains } =
    useWebWallet();

  const [showSeed, setShowSeed] = useState(false);
  const [seedPassword, setSeedPassword] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [seedError, setSeedError] = useState('');

  const [backupLoading, setBackupLoading] = useState(false);
  const [backupDone, setBackupDone] = useState(false);
  const [backupError, setBackupError] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [showBackupForm, setShowBackupForm] = useState(false);

  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  // Password change state
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwChangeError, setPwChangeError] = useState('');
  const [pwChangeSuccess, setPwChangeSuccess] = useState(false);
  const [pwChanging, setPwChanging] = useState(false);

  // Settings state
  const [settings, setSettings] = useState<WalletSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState('');

  // Daily spend limit state
  const [spendLimitEnabled, setSpendLimitEnabled] = useState(false);
  const [spendLimitValue, setSpendLimitValue] = useState('');
  const [spendLimitSaving, setSpendLimitSaving] = useState(false);
  const [spendLimitSuccess, setSpendLimitSuccess] = useState(false);
  const [spendLimitError, setSpendLimitError] = useState('');

  // Whitelist state
  const [whitelistEnabled, setWhitelistEnabled] = useState(false);
  const [whitelistAddresses, setWhitelistAddresses] = useState<string[]>([]);
  const [newAddress, setNewAddress] = useState('');
  const [newAddressError, setNewAddressError] = useState('');
  const [whitelistSaving, setWhitelistSaving] = useState(false);
  const [whitelistSuccess, setWhitelistSuccess] = useState(false);
  const [whitelistError, setWhitelistError] = useState('');

  // Display currency state
  const [displayCurrency, setDisplayCurrency] = useState<FiatCurrency>('USD');
  const [currencySaving, setCurrencySaving] = useState(false);
  const [currencySuccess, setCurrencySuccess] = useState(false);

  // Missing chains state
  const [missingChains, setMissingChains] = useState<string[]>([]);
  const [missingChainsLoading, setMissingChainsLoading] = useState(false);
  const [derivingChains, setDerivingChains] = useState(false);
  const [deriveSuccess, setDeriveSuccess] = useState('');
  const [deriveError, setDeriveError] = useState('');

  useEffect(() => {
    if (!isUnlocked) {
      router.replace('/web-wallet/unlock');
    }
  }, [isUnlocked, router]);

  // Load settings from API
  const loadSettings = useCallback(async () => {
    if (!wallet) return;
    setSettingsLoading(true);
    setSettingsError('');
    try {
      const data = await wallet.getSettings();
      setSettings(data);
      setSpendLimitEnabled(data.dailySpendLimit !== null && data.dailySpendLimit > 0);
      setSpendLimitValue(data.dailySpendLimit !== null && data.dailySpendLimit > 0
        ? String(data.dailySpendLimit)
        : '');
      setWhitelistEnabled(data.whitelistEnabled);
      setWhitelistAddresses(data.whitelistAddresses || []);
      setDisplayCurrency(data.displayCurrency || 'USD');
    } catch (err) {
      console.error('Failed to load security settings:', err);
      setSettingsError('Failed to load security settings');
    } finally {
      setSettingsLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    if (isUnlocked && wallet) {
      loadSettings();
    }
  }, [isUnlocked, wallet, loadSettings]);

  // Load missing chains
  const loadMissingChains = useCallback(async () => {
    if (!wallet) return;
    setMissingChainsLoading(true);
    try {
      const missing = await wallet.getMissingChains();
      setMissingChains(missing);
    } catch (err) {
      console.error('Failed to check missing chains:', err);
    } finally {
      setMissingChainsLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    if (isUnlocked && wallet) {
      loadMissingChains();
    }
  }, [isUnlocked, wallet, loadMissingChains]);

  // Derive missing chains handler
  const handleDeriveMissingChains = async () => {
    if (!wallet) return;
    setDeriveError('');
    setDeriveSuccess('');
    setDerivingChains(true);

    try {
      const results = await wallet.deriveMissingChains();
      if (results.length > 0) {
        const chains = results.map(r => r.chain).join(', ');
        setDeriveSuccess(`Successfully derived ${results.length} address${results.length > 1 ? 'es' : ''}: ${chains}`);
        // Refresh stored chains list and UI
        await refreshChains();
        // Reload missing chains (should be empty now)
        await loadMissingChains();
        setTimeout(() => setDeriveSuccess(''), 5000);
      } else {
        setDeriveError('No new addresses were derived. Chains may already exist.');
      }
    } catch (err) {
      console.error('Failed to derive missing chains:', err);
      setDeriveError(err instanceof Error ? err.message : 'Failed to derive addresses');
    } finally {
      setDerivingChains(false);
    }
  };

  const handleRevealSeed = async () => {
    if (!wallet) return;
    const m = wallet.getMnemonic();
    if (m) {
      setMnemonic(m);
      setSeedError('');
    } else {
      setSeedError('Mnemonic not available in current session');
    }
  };

  const handleDownloadBackup = async () => {
    if (!wallet || !walletId || !backupPassword) return;
    setBackupError('');
    setBackupLoading(true);
    try {
      const m = wallet.getMnemonic();
      if (!m) {
        setBackupError('Mnemonic not available. Unlock your wallet first.');
        return;
      }
      await downloadEncryptedSeedPhrase(m, backupPassword, walletId);
      setBackupDone(true);
      setBackupPassword('');
      setShowBackupForm(false);
      setTimeout(() => setBackupDone(false), 3000);
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleDelete = () => {
    deleteWallet();
    router.push('/web-wallet');
  };

  const handlePasswordChange = async () => {
    setPwChangeError('');
    setPwChangeSuccess(false);

    if (!currentPw) {
      setPwChangeError('Current password is required');
      return;
    }
    if (!newPw) {
      setPwChangeError('New password is required');
      return;
    }
    if (newPw.length < 8) {
      setPwChangeError('New password must be at least 8 characters');
      return;
    }
    if (newPw !== confirmPw) {
      setPwChangeError('Passwords do not match');
      return;
    }
    if (newPw === currentPw) {
      setPwChangeError('New password must be different from current');
      return;
    }

    setPwChanging(true);
    try {
      const success = await changePassword(currentPw, newPw);
      if (success) {
        setPwChangeSuccess(true);
        setCurrentPw('');
        setNewPw('');
        setConfirmPw('');
      } else {
        setPwChangeError('Incorrect current password');
      }
    } catch (err) {
      console.error('Failed to change password:', err);
      setPwChangeError('Failed to change password');
    } finally {
      setPwChanging(false);
    }
  };

  // Daily spend limit handlers
  const handleSpendLimitSave = async () => {
    if (!wallet) return;
    setSpendLimitError('');
    setSpendLimitSuccess(false);
    setSpendLimitSaving(true);

    try {
      let limit: number | null = null;
      if (spendLimitEnabled) {
        const parsed = parseFloat(spendLimitValue);
        if (isNaN(parsed) || parsed <= 0) {
          setSpendLimitError('Please enter a valid amount greater than 0');
          setSpendLimitSaving(false);
          return;
        }
        limit = parsed;
      }

      await wallet.updateSettings({ dailySpendLimit: limit });
      setSpendLimitSuccess(true);
      // Reload settings to confirm
      await loadSettings();
      setTimeout(() => setSpendLimitSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to update spend limit:', err);
      setSpendLimitError('Failed to update spend limit');
    } finally {
      setSpendLimitSaving(false);
    }
  };

  // Display currency handler
  const handleCurrencyChange = async (newCurrency: FiatCurrency) => {
    if (!wallet || newCurrency === displayCurrency) return;
    setCurrencySaving(true);
    setCurrencySuccess(false);
    try {
      await wallet.updateSettings({ displayCurrency: newCurrency });
      setDisplayCurrency(newCurrency);
      setCurrencySuccess(true);
      setTimeout(() => setCurrencySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to update currency:', err);
      // Revert on error
    } finally {
      setCurrencySaving(false);
    }
  };

  // Whitelist handlers
  const handleAddAddress = () => {
    const trimmed = newAddress.trim();
    if (!trimmed) {
      setNewAddressError('Address is required');
      return;
    }
    // Basic validation: length check
    if (trimmed.length < 20) {
      setNewAddressError('Address appears too short');
      return;
    }
    if (whitelistAddresses.some((a) => a.toLowerCase() === trimmed.toLowerCase())) {
      setNewAddressError('Address already in whitelist');
      return;
    }
    setWhitelistAddresses((prev) => [...prev, trimmed]);
    setNewAddress('');
    setNewAddressError('');
    setWhitelistSuccess(false);
  };

  const handleRemoveAddress = (address: string) => {
    setWhitelistAddresses((prev) => prev.filter((a) => a !== address));
    setWhitelistSuccess(false);
  };

  const handleWhitelistSave = async () => {
    if (!wallet) return;
    setWhitelistError('');
    setWhitelistSuccess(false);
    setWhitelistSaving(true);

    try {
      await wallet.updateSettings({
        whitelistEnabled,
        whitelistAddresses,
      });
      setWhitelistSuccess(true);
      await loadSettings();
      setTimeout(() => setWhitelistSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to update whitelist:', err);
      setWhitelistError('Failed to update whitelist');
    } finally {
      setWhitelistSaving(false);
    }
  };

  return (
    <>
      <WalletHeader />
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="mb-6">
          <Link
            href="/web-wallet"
            className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            &larr; Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-white">Settings</h1>
        </div>

        <div className="space-y-8">
          {/* Wallet Info */}
          <Section title="Wallet Info">
            <InfoRow label="Wallet ID">
              <span className="font-mono text-xs text-gray-300">
                {walletId || '—'}
              </span>
            </InfoRow>
            <InfoRow label="Chains">
              <div className="flex flex-wrap gap-1">
                {chains.map((c) => (
                  <ChainBadge key={c} chain={c} />
                ))}
              </div>
            </InfoRow>
          </Section>

          {/* Derive Missing Coins */}
          <Section title="Derive Missing Coins">
            {missingChainsLoading ? (
              <div className="space-y-3">
                <div className="h-10 rounded-lg bg-white/5 animate-pulse" />
              </div>
            ) : missingChains.length === 0 ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3">
                  <p className="text-sm text-green-400">
                    ✓ All supported coins are already configured for your wallet.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-400">
                  New coins have been added to the platform. Derive addresses for the following chains
                  to start using them with your wallet.
                </p>

                {/* Missing chains list */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-400">
                    Missing chains ({missingChains.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {missingChains.map((chain) => (
                      <span
                        key={chain}
                        className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-sm text-yellow-400"
                      >
                        {chain}
                      </span>
                    ))}
                  </div>
                </div>

                {deriveError && (
                  <p className="text-xs text-red-400" role="alert">
                    {deriveError}
                  </p>
                )}
                {deriveSuccess && (
                  <p className="text-xs text-green-400" role="status">
                    {deriveSuccess}
                  </p>
                )}

                <button
                  onClick={handleDeriveMissingChains}
                  disabled={derivingChains}
                  className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {derivingChains ? 'Deriving...' : 'Derive Missing Coins'}
                </button>
              </div>
            )}
          </Section>

          {/* Display Currency */}
          <Section title="Display Currency">
            <div className="space-y-3">
              <p className="text-sm text-gray-400">
                Choose your preferred currency for displaying exchange rates and values.
              </p>
              <div className="relative">
                <select
                  value={displayCurrency}
                  onChange={(e) => handleCurrencyChange(e.target.value as FiatCurrency)}
                  disabled={currencySaving || settingsLoading}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50 appearance-none cursor-pointer"
                >
                  {SUPPORTED_FIAT_CURRENCIES.map((currency) => (
                    <option key={currency.code} value={currency.code} className="bg-slate-900">
                      {currency.symbol} {currency.code} - {currency.name}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                  {currencySaving ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </div>
              </div>
              {currencySuccess && (
                <p className="text-xs text-green-400" role="status">
                  Currency updated
                </p>
              )}
            </div>
          </Section>

          {/* Daily Spend Limit */}
          <Section title="Daily Spend Limit">
            {settingsLoading ? (
              <div className="space-y-3">
                <div className="h-10 rounded-lg bg-white/5 animate-pulse" />
                <div className="h-10 rounded-lg bg-white/5 animate-pulse" />
              </div>
            ) : settingsError ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert">
                <p className="text-sm text-red-400">{settingsError}</p>
                <button
                  onClick={loadSettings}
                  className="mt-2 text-xs text-red-300 hover:text-red-200 underline transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-400">
                  Limit the total amount you can send per day. Helps protect against
                  unauthorized transactions.
                </p>

                {/* Enable toggle */}
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-gray-300">
                    Enable daily spend limit
                  </span>
                  <ToggleSwitch
                    checked={spendLimitEnabled}
                    onChange={(v) => {
                      setSpendLimitEnabled(v);
                      setSpendLimitSuccess(false);
                      if (!v) setSpendLimitValue('');
                    }}
                    label="Toggle daily spend limit"
                  />
                </label>

                {/* Amount input */}
                {spendLimitEnabled && (
                  <div className="space-y-2">
                    <label
                      htmlFor="spend-limit-amount"
                      className="block text-sm font-medium text-gray-300"
                    >
                      Daily limit (USD equivalent)
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                        $
                      </span>
                      <input
                        id="spend-limit-amount"
                        type="text"
                        inputMode="decimal"
                        value={spendLimitValue}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9.]/g, '');
                          setSpendLimitValue(val);
                          setSpendLimitSuccess(false);
                          setSpendLimitError('');
                        }}
                        placeholder="0.00"
                        className="w-full rounded-lg border border-white/10 bg-white/5 pl-8 pr-4 py-3 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                        aria-describedby={spendLimitError ? 'spend-limit-error' : undefined}
                      />
                    </div>
                  </div>
                )}

                {spendLimitError && (
                  <p id="spend-limit-error" className="text-xs text-red-400" role="alert">
                    {spendLimitError}
                  </p>
                )}
                {spendLimitSuccess && (
                  <p className="text-xs text-green-400" role="status">
                    Spend limit updated successfully
                  </p>
                )}

                <button
                  onClick={handleSpendLimitSave}
                  disabled={spendLimitSaving}
                  className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {spendLimitSaving ? 'Saving...' : 'Save Spend Limit'}
                </button>
              </div>
            )}
          </Section>

          {/* Address Whitelist */}
          <Section title="Address Whitelist">
            {settingsLoading ? (
              <div className="space-y-3">
                <div className="h-10 rounded-lg bg-white/5 animate-pulse" />
                <div className="h-20 rounded-lg bg-white/5 animate-pulse" />
              </div>
            ) : settingsError ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert">
                <p className="text-sm text-red-400">{settingsError}</p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-400">
                  When enabled, you can only send to addresses on this list.
                  This adds an extra layer of protection against sending to the wrong address.
                </p>

                {/* Enable toggle */}
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-gray-300">
                    Enable address whitelist
                  </span>
                  <ToggleSwitch
                    checked={whitelistEnabled}
                    onChange={(v) => {
                      setWhitelistEnabled(v);
                      setWhitelistSuccess(false);
                    }}
                    label="Toggle address whitelist"
                  />
                </label>

                {/* Address list */}
                {whitelistAddresses.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-400">
                      Whitelisted addresses ({whitelistAddresses.length})
                    </p>
                    <ul className="space-y-1.5 max-h-60 overflow-y-auto" role="list" aria-label="Whitelisted addresses">
                      {whitelistAddresses.map((addr) => (
                        <li
                          key={addr}
                          className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2 group"
                        >
                          <span
                            className="flex-1 truncate font-mono text-xs text-gray-300"
                            title={addr}
                          >
                            {addr}
                          </span>
                          <button
                            onClick={() => handleRemoveAddress(addr)}
                            className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-500/10 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                            aria-label={`Remove ${addr.slice(0, 8)}...`}
                            title="Remove address"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Add address */}
                <div className="space-y-2">
                  <label
                    htmlFor="whitelist-new-address"
                    className="block text-sm font-medium text-gray-300"
                  >
                    Add address
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="whitelist-new-address"
                      type="text"
                      value={newAddress}
                      onChange={(e) => {
                        setNewAddress(e.target.value);
                        setNewAddressError('');
                      }}
                      placeholder="Enter wallet address"
                      className={`flex-1 min-w-0 rounded-lg border bg-white/5 px-3 py-2.5 text-sm text-white placeholder-gray-500 font-mono focus:outline-none focus:ring-1 ${
                        newAddressError
                          ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                          : 'border-white/10 focus:border-purple-500 focus:ring-purple-500'
                      }`}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={!!newAddressError}
                      aria-describedby={newAddressError ? 'new-address-error' : undefined}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddAddress();
                      }}
                    />
                    <button
                      onClick={handleAddAddress}
                      className="shrink-0 rounded-lg bg-purple-600/20 px-4 py-2.5 text-sm font-medium text-purple-400 hover:bg-purple-600/30 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                  {newAddressError && (
                    <p id="new-address-error" className="text-xs text-red-400" role="alert">
                      {newAddressError}
                    </p>
                  )}
                </div>

                {whitelistError && (
                  <p className="text-xs text-red-400" role="alert">
                    {whitelistError}
                  </p>
                )}
                {whitelistSuccess && (
                  <p className="text-xs text-green-400" role="status">
                    Whitelist updated successfully
                  </p>
                )}

                <button
                  onClick={handleWhitelistSave}
                  disabled={whitelistSaving}
                  className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {whitelistSaving ? 'Saving...' : 'Save Whitelist Settings'}
                </button>
              </div>
            )}
          </Section>

          {/* Security */}
          <Section title="Security">
            <div className="space-y-3">
              <button
                onClick={lock}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-gray-300 hover:bg-white/10 transition-colors"
              >
                Lock Wallet Now
              </button>

              {/* Password Change */}
              {!showPasswordChange ? (
                <button
                  onClick={() => {
                    setShowPasswordChange(true);
                    setPwChangeSuccess(false);
                    setPwChangeError('');
                  }}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-gray-300 hover:bg-white/10 transition-colors"
                >
                  Change Password
                </button>
              ) : (
                <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
                  <h3 className="text-sm font-medium text-white">Change Password</h3>

                  <PasswordInput
                    label="Current Password"
                    value={currentPw}
                    onChange={setCurrentPw}
                    placeholder="Enter current password"
                  />
                  <PasswordInput
                    label="New Password"
                    value={newPw}
                    onChange={setNewPw}
                    placeholder="Enter new password"
                    showStrength
                  />
                  <PasswordInput
                    label="Confirm New Password"
                    value={confirmPw}
                    onChange={setConfirmPw}
                    placeholder="Confirm new password"
                  />

                  {pwChangeError && (
                    <p className="text-xs text-red-400" role="alert">{pwChangeError}</p>
                  )}
                  {pwChangeSuccess && (
                    <p className="text-xs text-green-400" role="status">Password changed successfully</p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowPasswordChange(false);
                        setCurrentPw('');
                        setNewPw('');
                        setConfirmPw('');
                        setPwChangeError('');
                        setPwChangeSuccess(false);
                      }}
                      className="flex-1 rounded-lg bg-white/5 px-4 py-2 text-sm text-gray-400 hover:bg-white/10 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handlePasswordChange}
                      disabled={pwChanging || !currentPw || !newPw || !confirmPw}
                      className="flex-1 rounded-lg bg-purple-600 px-4 py-2 text-sm text-white hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {pwChanging ? 'Changing...' : 'Update Password'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* Recovery Phrase */}
          <Section title="Recovery Phrase">
            {!showSeed ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3" role="alert">
                  <p className="text-xs text-yellow-400">
                    Never share your recovery phrase. Anyone with it can access your funds.
                  </p>
                </div>
                <button
                  onClick={() => setShowSeed(true)}
                  className="w-full rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400 hover:bg-yellow-500/20 transition-colors"
                >
                  Reveal Recovery Phrase
                </button>
              </div>
            ) : !mnemonic ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-400">
                  Click below to reveal your recovery phrase for this session.
                </p>
                {seedError && (
                  <p className="text-xs text-red-400" role="alert">{seedError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleRevealSeed}
                    className="flex-1 rounded-lg bg-yellow-600 px-4 py-2 text-sm text-white hover:bg-yellow-500 transition-colors"
                  >
                    Reveal
                  </button>
                  <button
                    onClick={() => setShowSeed(false)}
                    className="rounded-lg bg-white/5 px-4 py-2 text-sm text-gray-400 hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <SeedDisplay mnemonic={mnemonic} />
                <button
                  onClick={() => {
                    setMnemonic('');
                    setShowSeed(false);
                  }}
                  className="w-full rounded-lg bg-white/5 px-4 py-2 text-sm text-gray-400 hover:bg-white/10 transition-colors"
                >
                  Hide Recovery Phrase
                </button>
              </div>
            )}

            {/* Encrypted Backup Download */}
            <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
                <p className="text-xs text-blue-400">
                  Download an encrypted backup of your seed phrase. The file is GPG-encrypted (AES-256) with your wallet password. Decrypt with: <code className="bg-white/10 px-1 rounded">gpg --decrypt wallet_*_seedphrase.txt.gpg</code>
                </p>
              </div>
              {backupError && (
                <p className="text-xs text-red-400" role="alert">{backupError}</p>
              )}
              {!showBackupForm ? (
                <button
                  onClick={() => setShowBackupForm(true)}
                  disabled={backupDone}
                  className={`w-full rounded-lg border px-4 py-3 text-sm transition-colors ${
                    backupDone
                      ? 'border-green-500/30 bg-green-500/10 text-green-400'
                      : 'border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                  }`}
                >
                  {backupDone ? '✓ Downloaded!' : '⬇ Download Encrypted Backup'}
                </button>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs text-gray-400">Enter your wallet password to encrypt the backup:</label>
                  <PasswordInput
                    value={backupPassword}
                    onChange={setBackupPassword}
                    placeholder="Wallet password"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleDownloadBackup}
                      disabled={backupLoading || !backupPassword}
                      className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
                    >
                      {backupLoading ? 'Encrypting...' : '⬇ Download'}
                    </button>
                    <button
                      onClick={() => { setShowBackupForm(false); setBackupPassword(''); setBackupError(''); }}
                      className="rounded-lg bg-white/5 px-4 py-2 text-sm text-gray-400 hover:bg-white/10 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* Danger Zone */}
          <Section title="Danger Zone" danger>
            {!showDelete ? (
              <button
                onClick={() => setShowDelete(true)}
                className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Delete Wallet From Device
              </button>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4" role="alert">
                  <p className="text-sm text-red-400 font-medium">
                    This action cannot be undone.
                  </p>
                  <p className="mt-1 text-xs text-red-400">
                    The encrypted wallet data will be permanently removed from this
                    device. You can only recover your wallet using your seed phrase.
                  </p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="delete-confirm" className="block text-xs text-gray-400">
                    Type &quot;DELETE&quot; to confirm
                  </label>
                  <input
                    id="delete-confirm"
                    type="text"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder="DELETE"
                    className="w-full rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 text-sm text-white placeholder-red-400/50 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowDelete(false);
                      setDeleteConfirm('');
                    }}
                    className="flex-1 rounded-lg bg-white/5 px-4 py-2 text-sm text-gray-400 hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleteConfirm !== 'DELETE'}
                    className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Delete Permanently
                  </button>
                </div>
              </div>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

/* ── Toggle Switch Component ── */
function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
        checked ? 'bg-purple-600' : 'bg-white/20'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function Section({
  title,
  children,
  danger,
}: {
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div>
      <h2
        className={`mb-3 text-sm font-semibold ${
          danger ? 'text-red-400' : 'text-gray-300'
        }`}
      >
        {title}
      </h2>
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        {children}
      </div>
    </div>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-400">{label}</span>
      <div>{children}</div>
    </div>
  );
}
