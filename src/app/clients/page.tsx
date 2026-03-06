import { redirect } from 'next/navigation';

export default function ClientsRedirect() {
  redirect('/invoices?tab=clients');
}
