'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWebWallet } from '@/components/web-wallet/WalletContext';
import { WalletHeader } from '@/components/web-wallet/WalletHeader';
import { PasswordInput } from '@/components/web-wallet/PasswordInput';
import { SeedDisplay } from '@/components/web-wallet/SeedDisplay';
import { ChainBadge } from '@/components/web-wallet/AddressDisplay';

export default function SettingsPage() {
  const router = useRouter();
  const { wallet, walletId, chains, isUnlocked, deleteWallet, lock, changePassword } =
    useWebWallet();

  const [showSeed, setShowSeed] = useState(false);
  const [seedPassword, setSeedPassword] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [seedError, setSeedError] = useState('');

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

  useEffect(() => {
    if (!isUnlocked) {
      router.replace('/web-wallet/unlock');
    }
  }, [isUnlocked, router]);

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
    } catch {
      setPwChangeError('Failed to change password');
    } finally {
      setPwChanging(false);
    }
  };

  return (
    <>
      <WalletHeader />
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="mb-6">
          <Link
            href="/web-wallet"
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
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
                  <p className="mt-1 text-xs text-red-400/70">
                    The encrypted wallet data will be permanently removed from this
                    device. You can only recover your wallet using your seed phrase.
                  </p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="delete-confirm" className="block text-xs text-gray-500">
                    Type &quot;DELETE&quot; to confirm
                  </label>
                  <input
                    id="delete-confirm"
                    type="text"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder="DELETE"
                    className="w-full rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 text-sm text-white placeholder-red-900 focus:outline-none focus:ring-1 focus:ring-red-500"
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
      <span className="text-sm text-gray-500">{label}</span>
      <div>{children}</div>
    </div>
  );
}
