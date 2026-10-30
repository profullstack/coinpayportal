import type { ReactNode } from 'react';
import AdminNav from './AdminNav';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AdminNav />
      {children}
    </>
  );
}
