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
            CoinPay charges a platform fee of 0.5–1% on processed payments, depending on your 
            subscription plan (0.5% for Professional, 1% for Starter). This fee is automatically 
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
          <p className="text-gray-300 mb-4">
            CoinPay is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, 
            either express or implied, including but not limited to implied warranties of merchantability, 
            fitness for a particular purpose, and non-infringement.
          </p>
          <p className="text-gray-300 mb-4">
            In no event shall CoinPay, its directors, employees, partners, agents, suppliers, or affiliates 
            be liable for any indirect, incidental, special, consequential, or punitive damages, including 
            without limitation loss of profits, data, use, goodwill, or other intangible losses, resulting from:
          </p>
          <ul className="list-disc list-inside text-gray-300 space-y-2">
            <li>Your access to or use of (or inability to access or use) the service</li>
            <li>Any conduct or content of any third party on the service</li>
            <li>Blockchain network congestion, failures, or reorganizations</li>
            <li>Incorrect wallet addresses provided by you</li>
            <li>Unauthorized access to or alteration of your transmissions or data</li>
            <li>Fluctuations in cryptocurrency values</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">6. Indemnification</h2>
          <p className="text-gray-300">
            You agree to defend, indemnify, and hold harmless CoinPay and its officers, directors, employees, 
            and agents from and against any claims, damages, obligations, losses, liabilities, costs, or debt 
            arising from: (a) your use of and access to the service; (b) your violation of any term of these 
            Terms of Service; (c) your violation of any third-party right, including any intellectual property 
            or privacy right; or (d) any claim that your use of the service caused damage to a third party.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">7. Termination</h2>
          <p className="text-gray-300 mb-4">
            We may terminate or suspend your account immediately, without prior notice or liability, for any 
            reason, including without limitation if you breach these Terms. Upon termination, your right to 
            use the service will immediately cease.
          </p>
          <p className="text-gray-300">
            Any pending payments at the time of termination will be processed and forwarded to your designated 
            wallet address, minus applicable fees, within 30 days of account termination.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">8. Dispute Resolution</h2>
          <p className="text-gray-300 mb-4">
            Any dispute arising out of or relating to these Terms or the service shall first be resolved 
            through good-faith negotiation. If the dispute cannot be resolved within 30 days, either party 
            may submit the dispute to binding arbitration administered in accordance with the rules of the 
            American Arbitration Association.
          </p>
          <p className="text-gray-300">
            You agree that any arbitration shall be conducted on an individual basis and not in a class, 
            consolidated, or representative action. The arbitrator&apos;s decision shall be final and binding.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">9. Governing Law</h2>
          <p className="text-gray-300">
            These Terms shall be governed by and construed in accordance with the laws of the State of 
            Delaware, United States, without regard to its conflict of law provisions. Our failure to enforce 
            any right or provision of these Terms will not be considered a waiver of those rights.
          </p>
        </section>
        
        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-4 text-white">10. Contact</h2>
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