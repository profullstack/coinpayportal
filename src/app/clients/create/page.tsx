import { redirect } from 'next/navigation';

export default function CreateClientRedirect() {
  redirect('/invoices?tab=clients');
}
