import type { Metadata } from 'next';
import { SendMoneyForm } from '@/components/remittance/SendMoneyForm';

export const metadata: Metadata = {
  title: 'Send money abroad | CoinPay',
  description:
    'Send stablecoin, they receive local currency. Live quotes showing the fee and the rate margin, so you can see the whole cost.',
};

export default function RemittancePage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Send money abroad</h1>
        <p className="text-gray-400">
          You send stablecoin you already hold. They receive local currency in their bank or
          wallet. We show the fee and the rate margin separately, because most of what a transfer
          costs is hidden in the rate.
        </p>
      </div>

      <SendMoneyForm />
    </div>
  );
}
