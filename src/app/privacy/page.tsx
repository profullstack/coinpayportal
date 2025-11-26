export default function PrivacyPage() {
  return (
    <div className="container mx-auto px-4 py-16 max-w-4xl">
      <h1 className="text-4xl font-bold mb-8 text-white">Privacy Policy</h1>
      <div className="prose max-w-none">
        <p className="text-gray-400 mb-6">Last updated: November 26, 2025</p>
        
        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">Information We Collect</h2>
          <p className="text-gray-300 mb-4">
            CoinPay collects minimal information necessary to provide our payment gateway service:
          </p>
          <ul className="list-disc list-inside text-gray-300 space-y-2">
            <li>Email address and account credentials</li>
            <li>Business information (name, description)</li>
            <li>Cryptocurrency wallet addresses you provide</li>
            <li>Payment transaction data</li>
            <li>API usage logs</li>
          </ul>
        </section>
        
        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">How We Use Your Information</h2>
          <p className="text-gray-300 mb-4">
            We use your information to:
          </p>
          <ul className="list-disc list-inside text-gray-300 space-y-2">
            <li>Process cryptocurrency payments</li>
            <li>Send webhook notifications</li>
            <li>Provide customer support</li>
            <li>Improve our services</li>
            <li>Comply with legal obligations</li>
          </ul>
        </section>
        
        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">Data Security</h2>
          <p className="text-gray-300">
            We implement industry-standard security measures including encryption, 
            secure authentication, and regular security audits. We never store private keys 
            or have access to your cryptocurrency funds.
          </p>
        </section>
        
        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">Contact</h2>
          <p className="text-gray-300">
            For privacy-related questions, contact us at{' '}
            <a href="mailto:privacy@coinpayportal.com" className="text-purple-600 hover:text-purple-700">
              privacy@coinpayportal.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}