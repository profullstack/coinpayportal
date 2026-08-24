import { requireAdminPage } from '@/lib/auth/admin-guard';
import StatsContent from './StatsContent';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Stats · Admin · CoinPay',
  robots: { index: false, follow: false },
};

export default async function AdminStatsPage() {
  await requireAdminPage('/admin/stats');
  return <StatsContent />;
}
