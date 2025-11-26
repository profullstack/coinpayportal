export default function ContactPage() {
  return (
    <div className="container mx-auto px-4 py-16 max-w-4xl">
      <h1 className="text-4xl font-bold mb-8 text-white">Contact Us</h1>
      
      <div className="grid md:grid-cols-2 gap-8">
        <div>
          <h2 className="text-2xl font-bold mb-4 text-white">Get in Touch</h2>
          <p className="text-gray-300 mb-6">
            Have questions about CoinPay? We're here to help.
          </p>
          
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2 text-white">Email</h3>
              <a href="mailto:support@coinpayportal.com" className="text-purple-600 hover:text-purple-700">
                support@coinpayportal.com
              </a>
            </div>
            
            <div>
              <h3 className="font-semibold mb-2 text-white">Discord</h3>
              <a href="https://discord.gg/w5nHdzpQ29" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:text-purple-700">
                Join our Discord community
              </a>
            </div>
            
            <div>
              <h3 className="font-semibold mb-2 text-white">GitHub</h3>
              <a href="https://github.com/profullstack/coinpayportal" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:text-purple-700">
                Report issues or contribute
              </a>
            </div>
          </div>
        </div>
        
        <div>
          <h2 className="text-2xl font-bold mb-4 text-white">Documentation</h2>
          <p className="text-gray-300 mb-4">
            Looking for technical help? Check out our documentation.
          </p>
          <a href="/docs" className="inline-block bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-500 transition-colors">
            View Documentation
          </a>
        </div>
      </div>
    </div>
  );
}