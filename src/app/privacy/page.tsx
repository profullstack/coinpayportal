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
          <h2 className="text-2xl font-bold mb-4 text-white">Data Sharing</h2>
          <p className="text-gray-300 mb-4">
            We do not sell your personal information. We may share your data only in the following circumstances:
          </p>
          <ul className="list-disc list-inside text-gray-300 space-y-2">
            <li>With service providers who assist in operating our platform (e.g., hosting, analytics)</li>
            <li>When required by law, regulation, or legal process</li>
            <li>To protect the rights, property, or safety of CoinPay, our users, or the public</li>
            <li>In connection with a merger, acquisition, or sale of assets (with prior notice)</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">Cookies and Tracking</h2>
          <p className="text-gray-300 mb-4">
            We use essential cookies to maintain your session and preferences. We may also use 
            analytics cookies to understand how our service is used. You can control cookie 
            preferences through your browser settings.
          </p>
          <ul className="list-disc list-inside text-gray-300 space-y-2">
            <li><strong>Essential cookies:</strong> Required for authentication and core functionality</li>
            <li><strong>Analytics cookies:</strong> Help us understand usage patterns and improve the service</li>
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
          <h2 className="text-2xl font-bold mb-4 text-white">Data Retention</h2>
          <p className="text-gray-300">
            We retain your personal data for as long as your account is active or as needed to provide 
            services. Transaction records are retained for a minimum of 5 years to comply with financial 
            regulations. You may request deletion of your account data at any time, subject to legal 
            retention requirements.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">Your Rights</h2>
          <p className="text-gray-300 mb-4">
            Depending on your jurisdiction, you may have the following rights regarding your personal data:
          </p>
          <ul className="list-disc list-inside text-gray-300 space-y-2">
            <li><strong>Access:</strong> Request a copy of the personal data we hold about you</li>
            <li><strong>Correction:</strong> Request correction of inaccurate or incomplete data</li>
            <li><strong>Deletion:</strong> Request deletion of your personal data</li>
            <li><strong>Portability:</strong> Request a machine-readable copy of your data</li>
            <li><strong>Objection:</strong> Object to processing of your data for certain purposes</li>
            <li><strong>Restriction:</strong> Request restriction of processing in certain circumstances</li>
          </ul>
          <p className="text-gray-300 mt-4">
            To exercise any of these rights, contact us at{' '}
            <a href="mailto:privacy@coinpayportal.com" className="text-purple-600 hover:text-purple-700">
              privacy@coinpayportal.com
            </a>.
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