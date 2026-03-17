'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import LoginForm from './LoginForm';

const PasskeyButton = dynamic(() => import('./PasskeyButton'), {
  ssr: false,
  loading: () => null,
});

export default function LoginPage() {
  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            Welcome back
          </h1>
          <p className="text-gray-400">
            Log in to your CoinPay account
          </p>
        </div>

        <Suspense fallback={
          <div className="bg-slate-800 rounded-lg shadow-lg p-8 animate-pulse">
            <div className="space-y-6">
              <div className="h-10 bg-gray-700 rounded" />
              <div className="h-10 bg-gray-700 rounded" />
              <div className="h-12 bg-gray-700 rounded" />
            </div>
          </div>
        }>
          <LoginForm />
        </Suspense>

        <PasskeyButton />
      </div>
    </div>
  );
}
