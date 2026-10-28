import { requireAdminPage } from '@/lib/auth/admin-guard';
import OperatorVaultContent from './OperatorVaultContent';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Operator keys · Admin · CoinPay',
  robots: { index: false, follow: false },
};

export default async function AdminOperatorVaultPage() {
  await requireAdminPage('/admin/operator-vault');
  return <OperatorVaultContent />;
}
