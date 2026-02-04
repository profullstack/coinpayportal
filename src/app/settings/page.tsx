'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

interface Settings {
  notifications_enabled: boolean;
  email_notifications: boolean;
  web_notifications: boolean;
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>({
    notifications_enabled: true,
    email_notifications: true,
    web_notifications: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const result = await authFetch('/api/settings', {}, router);
      if (!result) return;

      const { response, data } = result;

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to load settings');
        setLoading(false);
        return;
      }

      setSettings(data.settings);
      setLoading(false);
    } catch (err) {
      setError('Failed to load settings');
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const result = await authFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      }, router);
      if (!result) return;

      const { response, data } = result;

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to save settings');
        setSaving(false);
        return;
      }

      setSuccess('Settings saved successfully!');
      setSaving(false);

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to save settings');
      setSaving(false);
    }
  };

  const handleToggle = (key: keyof Settings) => {
    setSettings((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Account Settings</h1>
          <p className="mt-2 text-gray-600">
            Manage your notification preferences and account settings
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
            {success}
          </div>
        )}

        {/* Settings Card */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          {/* Notifications Section */}
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Notifications
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              Choose how you want to be notified about payment updates
            </p>

            {/* Master Toggle */}
            <div className="flex items-center justify-between py-4">
              <div className="flex-1">
                <h3 className="text-base font-medium text-gray-900">
                  Enable Notifications
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Receive notifications about payment status changes
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleToggle('notifications_enabled')}
                className={`${
                  settings.notifications_enabled
                    ? 'bg-purple-600'
                    : 'bg-gray-200'
                } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2`}
                role="switch"
                aria-checked={settings.notifications_enabled}
              >
                <span
                  className={`${
                    settings.notifications_enabled
                      ? 'translate-x-5'
                      : 'translate-x-0'
                  } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                />
              </button>
            </div>

            {/* Email Notifications */}
            <div
              className={`flex items-center justify-between py-4 ${
                !settings.notifications_enabled ? 'opacity-50' : ''
              }`}
            >
              <div className="flex-1">
                <h3 className="text-base font-medium text-gray-900">
                  Email Notifications
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Receive email alerts for payment events
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleToggle('email_notifications')}
                disabled={!settings.notifications_enabled}
                className={`${
                  settings.email_notifications && settings.notifications_enabled
                    ? 'bg-purple-600'
                    : 'bg-gray-200'
                } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:cursor-not-allowed`}
                role="switch"
                aria-checked={settings.email_notifications}
              >
                <span
                  className={`${
                    settings.email_notifications &&
                    settings.notifications_enabled
                      ? 'translate-x-5'
                      : 'translate-x-0'
                  } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                />
              </button>
            </div>

            {/* Web Notifications */}
            <div
              className={`flex items-center justify-between py-4 ${
                !settings.notifications_enabled ? 'opacity-50' : ''
              }`}
            >
              <div className="flex-1">
                <h3 className="text-base font-medium text-gray-900">
                  Web Notifications
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Show browser notifications for real-time updates
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleToggle('web_notifications')}
                disabled={!settings.notifications_enabled}
                className={`${
                  settings.web_notifications && settings.notifications_enabled
                    ? 'bg-purple-600'
                    : 'bg-gray-200'
                } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:cursor-not-allowed`}
                role="switch"
                aria-checked={settings.web_notifications}
              >
                <span
                  className={`${
                    settings.web_notifications &&
                    settings.notifications_enabled
                      ? 'translate-x-5'
                      : 'translate-x-0'
                  } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                />
              </button>
            </div>
          </div>

          {/* Notification Events Info */}
          <div className="p-6 bg-gray-50">
            <h3 className="text-sm font-medium text-gray-900 mb-3">
              You'll be notified about:
            </h3>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start">
                <svg
                  className="h-5 w-5 text-green-500 mr-2 flex-shrink-0"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M5 13l4 4L19 7"></path>
                </svg>
                Payment detected on blockchain
              </li>
              <li className="flex items-start">
                <svg
                  className="h-5 w-5 text-green-500 mr-2 flex-shrink-0"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M5 13l4 4L19 7"></path>
                </svg>
                Payment confirmed (sufficient confirmations)
              </li>
              <li className="flex items-start">
                <svg
                  className="h-5 w-5 text-green-500 mr-2 flex-shrink-0"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M5 13l4 4L19 7"></path>
                </svg>
                Payment forwarded to your wallet
              </li>
              <li className="flex items-start">
                <svg
                  className="h-5 w-5 text-green-500 mr-2 flex-shrink-0"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M5 13l4 4L19 7"></path>
                </svg>
                Payment failed or expired
              </li>
            </ul>
          </div>

          {/* Save Button */}
          <div className="p-6 bg-white border-t border-gray-200">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="text-gray-600 hover:text-gray-900 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="bg-purple-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>

        {/* Global Wallets Card */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden mt-8">
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="p-3 bg-purple-100 rounded-full">
                  <svg
                    className="h-6 w-6 text-purple-600"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path>
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Global Wallet Addresses
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Define wallet addresses once and import them into any business
                  </p>
                </div>
              </div>
              <button
                onClick={() => router.push('/settings/wallets')}
                className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Manage Wallets
                <svg
                  className="ml-2 h-4 w-4"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M9 5l7 7-7 7"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Additional Info */}
        <div className="mt-6 text-center text-sm text-gray-500">
          <p>
            Email notifications are powered by Mailgun and sent to your
            registered email address.
          </p>
        </div>
      </div>
    </div>
  );
}