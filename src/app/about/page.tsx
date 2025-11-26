export default function AboutPage() {
  return (
    <div className="container mx-auto px-4 py-16 max-w-4xl">
      <h1 className="text-4xl font-bold mb-8 text-white">About CoinPay</h1>
      <div className="prose max-w-none">
        <p className="text-lg text-gray-300 mb-6">
          CoinPay is a non-custodial cryptocurrency payment gateway built for modern e-commerce.
        </p>
        
        <h2 className="text-2xl font-bold mt-8 mb-4 text-white">What We Do</h2>
        <p className="text-gray-300 mb-4">
          We enable online merchants to accept Bitcoin, Ethereum, Solana, Polygon, and USDC payments
          without holding customer funds. Payments go directly to your wallet with a simple 0.5% transaction fee.
        </p>

        <h2 className="text-2xl font-bold mt-8 mb-4 text-white">Why CoinPay?</h2>
        <ul className="list-disc list-inside text-gray-300 space-y-2 mb-6">
          <li>Non-custodial - You control your funds</li>
          <li>0.5% transaction fee - Lower than traditional processors</li>
          <li>Real-time processing - Instant payment detection</li>
          <li>Multi-chain support - BTC, ETH, SOL, MATIC, USDC</li>
          <li>Simple integration - RESTful API and webhooks</li>
        </ul>

        <h2 className="text-2xl font-bold mt-8 mb-4 text-white">Built By</h2>
        <p className="text-gray-300">
          CoinPay is developed by{' '}
          <a href="https://profullstack.com" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:text-purple-700 font-medium">
            Profullstack, Inc.
          </a>
          {' '}— a team dedicated to building practical blockchain solutions for real businesses.
        </p>
      </div>
    </div>
  );
}