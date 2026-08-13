import { requireAdminPage } from '@/lib/auth/admin-guard';
import UsersContent from './UsersContent';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Users · Admin · CoinPay',
  robots: { index: false, follow: false },
};

export default async function AdminUsersPage() {
  await requireAdminPage('/admin/users');
  return <UsersContent />;
}
