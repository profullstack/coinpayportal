import { requireAdminPage } from '@/lib/auth/admin-guard';
import BusinessesContent from './BusinessesContent';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Businesses · Admin · CoinPay',
  robots: { index: false, follow: false },
};

export default async function AdminBusinessesPage() {
  await requireAdminPage('/admin/businesses');
  return <BusinessesContent />;
}
