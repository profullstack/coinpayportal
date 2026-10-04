import type { Metadata } from 'next';
import CloudBrowserViewer from '../../../CloudBrowserViewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Connect your bank · CoinPay',
  robots: { index: false, follow: false },
};

/** /finances/statements/connect/:id — sign in to a bank through CoinPay's cloud browser. */
export default async function ConnectBankPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CloudBrowserViewer liveId={id} />;
}
