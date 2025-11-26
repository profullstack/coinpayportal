export default function HelpPage() {
  return (
    <div className="container mx-auto px-4 py-16 max-w-4xl">
      <h1 className="text-4xl font-bold mb-8 text-white">Help Center</h1>
      
      <div className="space-y-8">
        <section>
          <h2 className="text-2xl font-bold mb-4 text-white">Getting Started</h2>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2 text-white">How do I start accepting crypto payments?</h3>
              <p className="text-gray-300">
                Sign up for a CoinPay account, create a business, and add your wallet addresses. 
                You'll get API credentials to integrate payments into your website.
              </p>
            </div>
            
            <div>
              <h3 className="font-semibold mb-2 text-white">What cryptocurrencies are supported?</h3>
              <p className="text-gray-300">
                We support Bitcoin (BTC), Ethereum (ETH), Solana (SOL), Polygon (MATIC), 
                Bitcoin Cash (BCH), and USDC on multiple chains.
              </p>
            </div>
            
            <div>
              <h3 className="font-semibold mb-2 text-white">What are the fees?</h3>
              <p className="text-gray-300">
                CoinPay charges a simple 0.5% transaction fee. You receive 99.5% of each payment 
                directly to your wallet.
              </p>
            </div>
          </div>
        </section>
        
        <section>
          <h2 className="text-2xl font-bold mb-4 text-white">Technical Support</h2>
          <p className="text-gray-300 mb-4">
            For technical questions, check our{' '}
            <a href="/docs" className="text-purple-600 hover:text-purple-700 font-medium">
              documentation
            </a>
            {' '}or join our{' '}
            <a href="https://discord.gg/w5nHdzpQ29" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:text-purple-700 font-medium">
              Discord community
            </a>.
          </p>
        </section>
      </div>
    </div>
  );
}