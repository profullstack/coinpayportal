export default function TermsPage() {
  return (
    <div className="container mx-auto px-4 py-16 max-w-4xl">
      <h1 className="text-4xl font-bold mb-8 text-white">Terms of Service</h1>
      <div className="prose max-w-none">
        <p className="text-gray-400 mb-6">Last updated: November 26, 2025</p>
        
        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">1. Acceptance of Terms</h2>
          <p className="text-gray-300">
            By accessing and using CoinPay, you accept and agree to be bound by these Terms of Service.
          </p>
        </section>
        
        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">2. Service Description</h2>
          <p className="text-gray-300 mb-4">
            CoinPay provides a non-custodial cryptocurrency payment gateway service. We facilitate 
            the acceptance of cryptocurrency payments but do not hold, custody, or control your funds.
          </p>
        </section>
        
        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">3. Fees</h2>
          <p className="text-gray-300 mb-4">
            CoinPay charges a 0.5% transaction fee on all processed payments. This fee is automatically 
            deducted when payments are forwarded to your wallet.
          </p>
        </section>
        
        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">4. User Responsibilities</h2>
          <ul className="list-disc list-inside text-gray-300 space-y-2">
            <li>Maintain the security of your account credentials</li>
            <li>Provide accurate wallet addresses</li>
            <li>Comply with applicable laws and regulations</li>
            <li>Not use the service for illegal activities</li>
          </ul>
        </section>
        
        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">5. Limitation of Liability</h2>
          <p className="text-gray-300">
            CoinPay is provided "as is" without warranties. We are not liable for losses due to 
            blockchain network issues, incorrect wallet addresses, or other factors outside our control.
          </p>
        </section>
        
        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">6. Contact</h2>
          <p className="text-gray-300">
            For questions about these terms, contact{' '}
            <a href="mailto:legal@coinpayportal.com" className="text-purple-600 hover:text-purple-700">
              legal@coinpayportal.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}