import { requireAdminPage } from '@/lib/auth/admin-guard';
import EscrowsContent from './EscrowsContent';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Escrows · Admin · CoinPay',
  robots: { index: false, follow: false },
};

export default async function AdminEscrowsPage() {
  await requireAdminPage('/admin/escrows');
  return <EscrowsContent />;
}
