import { requireAdminPage } from '@/lib/auth/admin-guard';
import EmailBroadcastForm from './EmailBroadcastForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Email Broadcast · Admin · CoinPay',
  robots: { index: false, follow: false },
};

export default async function EmailBroadcastPage() {
  await requireAdminPage('/admin/email-broadcast');

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <h1 className="text-3xl font-bold text-white mb-2">Email broadcast</h1>
      <p className="text-gray-400 mb-8">
        Send a message to all registered merchants.
      </p>

      <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
        <h2 className="text-lg font-semibold text-white mb-1">Compose broadcast</h2>
        <p className="text-sm text-gray-400 mb-4">
          This will send to every merchant email in the database.
        </p>
        <EmailBroadcastForm />
      </section>
    </div>
  );
}
