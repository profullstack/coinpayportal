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
                We support Bitcoin (BTC), Bitcoin Cash (BCH), Ethereum (ETH), Polygon (POL),
                Solana (SOL), Dogecoin (DOGE), XRP, Cardano (ADA), BNB, plus USDT and USDC
                on Ethereum, Polygon, and Solana.
              </p>
            </div>
            
            <div>
              <h3 className="font-semibold mb-2 text-white">What are the fees?</h3>
              <p className="text-gray-300">
                CoinPay charges a simple 0.5% platform fee. You receive 99.5% of each payment
                to your wallet, minus blockchain network fees. Network fees vary by
                blockchain (e.g., ~$0.00025 for Solana, ~$0.50-5 for Ethereum) and are outside our control.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-4 text-white">Custody &amp; Trust</h2>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2 text-white">Who holds my money right now?</h3>
              <p className="text-gray-300">
                It depends which product you&apos;re using, so we don&apos;t answer this with a
                single word. Your web wallet keys are generated in your browser and never sent to
                us. Incoming payments land at an address we control and are forwarded to your
                wallet — usually well under a minute after confirmation, but we hold that key until
                the forward completes. Default escrow is held by us for the whole escrow window.
                Lightning balances sit on our node until you withdraw.{' '}
                <a href="/custody" className="text-purple-600 hover:text-purple-700 font-medium">
                  Full breakdown by product
                </a>
                .
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-2 text-white">
                What happens to my funds if CoinPay shuts down?
              </h3>
              <p className="text-gray-300">
                Anything already in your own wallet is unaffected — we never had those keys, and
                your web wallet seed lives in your browser (export it before you need it). A 2-of-3
                multisig escrow can be settled by the depositor and beneficiary together without us
                signing at all. But funds in default custodial escrow, in Lightning, or mid-forward
                are held at addresses derived from our seed: there is no third-party backup and no
                on-chain mechanism that releases them without us. Keep working balances small and
                use multisig escrow for amounts you can&apos;t afford to have depend on us.
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-2 text-white">
                If there&apos;s a dispute, who decides and on what evidence?
              </h3>
              <p className="text-gray-300">
                Either party can dispute a funded escrow. If you named an arbiter when creating it,
                that party decides. If you didn&apos;t, <strong className="text-white">CoinPay
                decides</strong> — the same company operating the escrow. The evidence is what&apos;s
                attached to the escrow: the job description and deliverables in its metadata, the
                stated dispute reason, and the timestamped event log. There&apos;s no published
                response time and no appeal. On a multisig escrow the arbiter can only propose an
                outcome — it still needs a second signature. A funded escrow also can&apos;t hang
                forever: at expiry it auto-refunds the depositor, or auto-releases to the
                beneficiary if that was enabled at creation.
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
