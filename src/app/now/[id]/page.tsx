import { redirect } from 'next/navigation';

export default async function NowRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/invoices/${id}/pay`);
}
