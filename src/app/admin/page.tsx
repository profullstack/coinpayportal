import { requireAdminPage } from '@/lib/auth/admin-guard';
import AdminContent from './AdminContent';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · CoinPay',
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  await requireAdminPage('/admin');
  return <AdminContent />;
}
