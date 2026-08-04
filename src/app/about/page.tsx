export default function AboutPage() {
  return (
    <div className="container mx-auto px-4 py-16 max-w-4xl">
      <h1 className="text-4xl font-bold mb-8 text-white">About CoinPay</h1>
      <div className="prose max-w-none">
        <p className="text-lg text-gray-300 mb-6">
          CoinPay is a cryptocurrency payment gateway, escrow, and wallet service built for modern
          e-commerce and for AI agents.
        </p>

        <h2 className="text-2xl font-bold mt-8 mb-4 text-white">What We Do</h2>
        <p className="text-gray-300 mb-4">
          We enable online merchants to accept Bitcoin, Ethereum, Solana, Polygon, and USDC payments
          for a 0.5% transaction fee. Customers pay to an address we derive, and our monitor forwards
          the balance to your wallet — usually well under a minute after confirmation. We hold the key
          to that address until the forward completes, so payments pass through us rather than around
          us.
        </p>
        <p className="text-gray-300 mb-4">
          Our web wallet is genuinely non-custodial: its keys are generated in your browser and never
          reach our servers. Our default escrow is genuinely custodial: we hold the funds for the
          length of the job. We describe each one as what it is, and{' '}
          <a href="/custody" className="text-purple-400 hover:text-purple-300">
            spell out the whole picture here
          </a>{' '}
          — including what happens to your funds if we shut down, and who decides disputes.
        </p>

        <h2 className="text-2xl font-bold mt-8 mb-4 text-white">Why CoinPay?</h2>
        <ul className="list-disc list-inside text-gray-300 space-y-2 mb-6">
          <li>0.5% transaction fee - Lower than traditional processors</li>
          <li>Non-custodial web wallet - Your keys never leave your browser</li>
          <li>2-of-3 multisig escrow - We hold one key of three, never enough to act alone</li>
          <li>Real-time processing - Instant payment detection</li>
          <li>Multi-chain support - BTC, ETH, SOL, POL, USDC</li>
          <li>Simple integration - RESTful API and webhooks</li>
          <li>MIT licensed - The server handling your funds is public and auditable</li>
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