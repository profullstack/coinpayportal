import Link from 'next/link';
import { PaymentDemo } from '@/components/demo/PaymentDemo';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 sm:pt-24 sm:pb-32">
          {/* AI Agent Discovery */}
          <div className="mb-6 mx-auto max-w-xl">
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
              <span>🤖 AI Agent?</span>
              <code className="bg-slate-800/80 px-2 py-1 rounded font-mono text-emerald-400">curl -s https://coinpayportal.com/skill.md</code>
            </div>
          </div>

          {/* Feature Banners */}
          <div className="mb-8 mx-auto max-w-3xl space-y-4">
            {/* Web Wallet Banner */}
            <Link href="/web-wallet" className="block group">
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-500/20 via-cyan-500/20 to-blue-500/20 border border-emerald-500/30 p-4 sm:p-5 transition-all group-hover:border-emerald-400/50 group-hover:shadow-lg group-hover:shadow-emerald-500/10">
                <div className="relative flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center text-2xl">
                      💳
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="inline-flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider bg-emerald-500/30 text-emerald-300 rounded-full">
                        Web Wallet
                      </span>
                      <span className="text-emerald-400 text-xs group-hover:translate-x-1 transition-transform">→ Open wallet</span>
                    </div>
                    <p className="text-gray-200 text-sm leading-relaxed">
                      <span className="font-semibold text-white">Non-custodial multi-chain wallet.</span>{' '}
                      BTC, ETH, SOL, POL, BCH + USDC. Receive payments, pay for services. API-first. No KYC.
                    </p>
                  </div>
                </div>
              </div>
            </Link>

            {/* Escrow Banner */}
            <Link href="/docs#escrow" className="block group">
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-red-500/20 border border-amber-500/30 p-4 sm:p-5 transition-all group-hover:border-amber-400/50 group-hover:shadow-lg group-hover:shadow-amber-500/10">
                <div className="relative flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-400 flex items-center justify-center text-2xl">
                      🔐
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="inline-flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider bg-amber-500/30 text-amber-300 rounded-full">
                        New: Escrow
                      </span>
                      <span className="text-amber-400 text-xs group-hover:translate-x-1 transition-transform">→ Learn more</span>
                    </div>
                    <p className="text-gray-200 text-sm leading-relaxed">
                      <span className="font-semibold text-white">Trustless escrow for any deal.</span>{' '}
                      Hold funds until both sides are satisfied. Token-based auth, no accounts needed. Perfect for freelance gigs and agent-to-agent trades.
                    </p>
                  </div>
                </div>
              </div>
            </Link>

            {/* DID Reputation Banner */}
            <Link href="/reputation" className="block group">
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-500/20 via-purple-500/20 to-fuchsia-500/20 border border-violet-500/30 p-4 sm:p-5 transition-all group-hover:border-violet-400/50 group-hover:shadow-lg group-hover:shadow-violet-500/10">
                <div className="relative flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-400 flex items-center justify-center text-2xl">
                      🆔
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="inline-flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider bg-violet-500/30 text-violet-300 rounded-full">
                        New: DID Reputation
                      </span>
                      <span className="text-violet-400 text-xs group-hover:translate-x-1 transition-transform">→ Claim your DID</span>
                    </div>
                    <p className="text-gray-200 text-sm leading-relaxed">
                      <span className="font-semibold text-white">Portable, cross-platform reputation.</span>{' '}
                      Claim a decentralized identity, build trust through escrow settlements, and carry your reputation across platforms like ugig.net.
                    </p>
                  </div>
                </div>
              </div>
            </Link>

            {/* x402 Protocol Banner */}
            <Link href="/x402" className="block group">
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-yellow-500/20 via-orange-500/20 to-red-500/20 border border-yellow-500/30 p-4 sm:p-5 transition-all group-hover:border-yellow-400/50 group-hover:shadow-lg group-hover:shadow-yellow-500/10">
                <div className="relative flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-400 to-red-400 flex items-center justify-center text-2xl">
                      ⚡
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="inline-flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider bg-yellow-500/30 text-yellow-300 rounded-full">
                        New: x402 Protocol
                      </span>
                      <span className="text-yellow-400 text-xs group-hover:translate-x-1 transition-transform">→ Get started</span>
                    </div>
                    <p className="text-gray-200 text-sm leading-relaxed">
                      <span className="font-semibold text-white">HTTP-native machine payments.</span>{' '}
                      The only multi-chain x402 facilitator. AI agents pay for APIs with BTC, ETH, SOL, USDC, Lightning &amp; more — all via HTTP 402.
                    </p>
                  </div>
                </div>
              </div>
            </Link>
          </div>

          {/* Logo/Brand */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 mb-4 shadow-lg shadow-purple-500/50">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white mb-6 tracking-tight">
              Coin<span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">Pay</span>
            </h1>
            <p className="text-xl sm:text-2xl text-gray-300 mb-4 max-w-3xl mx-auto">
              Payments, Escrow &amp; Wallets for Humans and AI Agents
            </p>
            <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
              Non-custodial crypto infrastructure — accept payments, hold funds in escrow, and manage wallets. API-first, no KYC, built for the agent economy.
            </p>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16">
            <Link
              href="/dashboard"
              className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl shadow-lg shadow-purple-500/50 hover:shadow-purple-500/70 hover:scale-105 transition-all duration-200 text-center"
            >
              Get Started Free
            </Link>
            <Link
              href="/docs"
              className="w-full sm:w-auto px-8 py-4 bg-white/10 backdrop-blur-sm text-white font-semibold rounded-xl border border-white/20 hover:bg-white/20 hover:scale-105 transition-all duration-200 text-center"
            >
              View Documentation
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto mb-12">
            {[
              { label: 'Transactions Processed', value: '47K+' },
              { label: 'Active Merchants', value: '1,200+' },
              { label: 'Total Volume', value: '$8.2M+' },
              { label: 'Countries', value: '45+' },
            ].map((stat, index) => (
              <div key={index} className="text-center p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
                <div className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-2">
                  {stat.value}
                </div>
                <div className="text-sm text-gray-400">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Secondary Stats */}
          <div className="flex flex-wrap justify-center gap-8 text-center">
            {[
              { label: 'Transaction Fee', value: '0.5-1%' },
              { label: 'Supported Chains', value: '10+' },
              { label: 'Avg. Processing', value: '<1 min' },
              { label: 'Uptime', value: '99.9%' },
            ].map((stat, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="text-purple-400 font-semibold">{stat.value}</span>
                <span className="text-gray-500 text-sm">{stat.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Live Demo Section */}
      <section className="relative py-24 bg-slate-900/50" id="demo">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
                Try It <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">Live</span>
              </h2>
              <p className="text-xl text-gray-400 mb-8">
                Experience our payment flow firsthand. This demo simulates the complete payment process from creation to confirmation.
              </p>
              <ul className="space-y-4">
                {[
                  'Create a payment with any amount',
                  'Choose from multiple cryptocurrencies',
                  'Watch real-time status updates',
                  'See automatic confirmation handling',
                ].map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="w-6 h-6 text-purple-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <PaymentDemo />
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="relative py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              Why Choose CoinPay?
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Built for developers, designed for businesses
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: (
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                ),
                title: 'Non-Custodial',
                description: 'You control your private keys. Funds go directly to your wallet with no intermediaries.',
              },
              {
                icon: (
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                ),
                title: 'Lightning Fast',
                description: 'Real-time payment processing with instant confirmations and automatic status updates.',
              },
              {
                icon: (
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                ),
                title: 'Secure & Audited',
                description: 'Bank-grade security with regular audits and comprehensive monitoring.',
              },
              {
                icon: (
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8zM15 7h.01M9 7h.01" />
                  </svg>
                ),
                title: 'Trustless Escrow',
                description: 'Hold funds until both parties are satisfied. Token-based auth — no accounts, no KYC. Dispute resolution built in.',
              },
              {
                icon: (
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                ),
                title: 'AI Agent Ready',
                description: 'Feed your agent /skill.md and it creates wallets, sends payments, and manages escrows autonomously. Built for the agent economy.',
              },
              {
                icon: (
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                ),
                title: 'Multi-Chain Wallet',
                description: 'Non-custodial web wallet with BTC, ETH, SOL, POL, BCH, and USDC. CLI, REST API, and web UI included.',
              },
              {
                icon: (
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                ),
                title: 'x402 Protocol',
                description: 'HTTP-native machine payments via HTTP 402. The only multi-chain facilitator — agents pay with any crypto, Lightning, or fiat.',
              },
            ].map((feature, index) => (
              <div
                key={index}
                className="group p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-purple-500/50 transition-all duration-300 hover:scale-105"
              >
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mb-6 text-white group-hover:shadow-lg group-hover:shadow-purple-500/50 transition-all duration-300">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold text-white mb-3">{feature.title}</h3>
                <p className="text-gray-400 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Supported Chains Section */}
      <section className="relative py-24 bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              Supported Blockchains
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Accept payments on all major networks
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-6">
            {[
              { name: 'Bitcoin', symbol: 'BTC', icon: '₿', color: 'from-orange-500 to-yellow-500' },
              { name: 'Ethereum', symbol: 'ETH', icon: '⟠', color: 'from-blue-500 to-purple-500' },
              { name: 'Solana', symbol: 'SOL', icon: '◎', color: 'from-purple-500 to-green-500' },
              { name: 'Polygon', symbol: 'POL', icon: '⬡', color: 'from-purple-500 to-blue-500' },
              { name: 'Bitcoin Cash', symbol: 'BCH', icon: '₿', color: 'from-green-500 to-emerald-500' },
            ].map((chain, index) => (
              <div
                key={index}
                className="p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/30 transition-all text-center group"
              >
                <div className={`w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br ${chain.color} flex items-center justify-center mb-4 text-3xl text-white group-hover:scale-110 transition-transform`}>
                  {chain.icon}
                </div>
                <div className="text-white font-semibold">{chain.name}</div>
                <div className="text-gray-400 text-sm">{chain.symbol}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Connect Your Agent Section */}
      <section className="relative py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 rounded-full border border-emerald-500/30">
              AI Agents
            </span>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mt-4 mb-4">
              Connect Your Agent
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Give your AI agent its own wallet, payments, and escrow. Just send it the skill file — it handles the rest.
            </p>
          </div>

          <div className="max-w-3xl mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-10">
              {[
                { step: '1', title: 'Share Instructions', desc: 'Send your agent the skill file URL' },
                { step: '2', title: 'Agent Creates Wallet', desc: 'It registers, gets addresses, and is ready to transact' },
                { step: '3', title: 'Send, Receive & Escrow', desc: 'Your agent can pay, get paid, and hold funds in escrow — autonomously' },
              ].map((item, i) => (
                <div key={i} className="relative p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 text-center">
                  <div className="w-10 h-10 mx-auto rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center mb-3 text-white font-bold text-sm">
                    {item.step}
                  </div>
                  <h3 className="text-white font-semibold mb-1">{item.title}</h3>
                  <p className="text-gray-400 text-sm">{item.desc}</p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl bg-slate-800/80 backdrop-blur-sm border border-white/10 p-6 sm:p-8">
              <p className="text-gray-300 text-sm mb-4">
                Point your AI agent to this URL and it will know how to create a wallet, authenticate, check balances, and send transactions:
              </p>
              <div className="flex items-center gap-3 bg-slate-900/80 rounded-xl p-4 border border-white/5">
                <code className="flex-1 text-emerald-400 text-sm sm:text-base font-mono break-all">
                  https://coinpayportal.com/skill.md
                </code>
              </div>
              <p className="text-gray-500 text-xs mt-3">
                Works with Claude, ChatGPT, and any agent framework that reads skill files.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Escrow Section */}
      <section className="relative py-24 bg-slate-900/50" id="escrow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 rounded-full border border-amber-500/30">
              Escrow Service
            </span>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mt-4 mb-4">
              Trustless Escrow for Any Deal
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Hold crypto in escrow until both sides are happy. No accounts needed — just tokens. Perfect for freelance gigs, agent-to-agent trades, and marketplace transactions.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-12 items-start">
            {/* Escrow Flow Steps */}
            <div className="space-y-6">
              <h3 className="text-2xl font-bold text-white mb-2">How It Works</h3>
              {[
                { step: '1', title: 'Create Escrow', desc: 'Specify amount, chain, and beneficiary address. Get a unique deposit address and two auth tokens.', color: 'from-amber-400 to-orange-400' },
                { step: '2', title: 'Deposit Funds', desc: 'Depositor sends crypto to the escrow address. Auto-detected by our monitor — no manual confirmation needed.', color: 'from-orange-400 to-red-400' },
                { step: '3', title: 'Release or Dispute', desc: 'Depositor releases funds when satisfied, or opens a dispute. Refunds return full amount (no fee).', color: 'from-red-400 to-pink-400' },
                { step: '4', title: 'Settlement', desc: 'Funds forwarded on-chain to the beneficiary minus platform fee (0.5–1%). Fully automatic.', color: 'from-pink-400 to-purple-400' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-4 p-4 rounded-xl bg-white/5 border border-white/5">
                  <div className={`w-10 h-10 shrink-0 rounded-full bg-gradient-to-br ${item.color} flex items-center justify-center text-white font-bold text-sm`}>
                    {item.step}
                  </div>
                  <div>
                    <h4 className="text-white font-semibold">{item.title}</h4>
                    <p className="text-gray-400 text-sm mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}

              <div className="grid grid-cols-2 gap-4 pt-2">
                {[
                  { label: 'Anonymous', desc: 'Token-based auth, no KYC' },
                  { label: 'Multi-Chain', desc: 'BTC, ETH, SOL, POL + more' },
                  { label: 'Auto-Detect', desc: 'Deposits confirmed on-chain' },
                  { label: 'Dispute Flow', desc: 'Built-in arbiter support' },
                ].map((item, i) => (
                  <div key={i} className="p-3 rounded-lg bg-white/5 border border-white/5">
                    <div className="text-amber-400 font-semibold text-sm">{item.label}</div>
                    <div className="text-gray-500 text-xs">{item.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Escrow API Example */}
            <div className="space-y-6">
              <h3 className="text-2xl font-bold text-white mb-2">API Example</h3>
              <div className="rounded-2xl bg-slate-800/80 backdrop-blur-sm border border-white/10 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-slate-800/80 border-b border-white/10">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="ml-2 text-sm text-gray-400">Create Escrow</span>
                </div>
                <pre className="p-4 text-sm overflow-x-auto">
                  <code className="text-gray-300">
{`curl -X POST https://coinpayportal.com/api/escrow \\
  -H "Content-Type: application/json" \\
  -d '{
    "chain": "ETH",
    "amount": 0.5,
    "depositor_address": "0xAlice...",
    "beneficiary_address": "0xBob...",
    "expires_in_hours": 48
  }'

# Response:
{
  "id": "a1b2c3d4...",
  "escrow_address": "0xEscrow...",
  "status": "created",
  "release_token": "esc_abc123...",
  "beneficiary_token": "esc_def456..."
}`}
                  </code>
                </pre>
              </div>

              <div className="rounded-2xl bg-slate-800/80 backdrop-blur-sm border border-white/10 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-slate-800/80 border-b border-white/10">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="ml-2 text-sm text-gray-400">Release Funds</span>
                </div>
                <pre className="p-4 text-sm overflow-x-auto">
                  <code className="text-gray-300">
{`# Depositor releases when satisfied
curl -X POST https://coinpayportal.com/api/escrow/a1b2c3d4/release \\
  -H "Content-Type: application/json" \\
  -d '{ "release_token": "esc_abc123..." }'

# → Funds forwarded to beneficiary on-chain ✓`}
                  </code>
                </pre>
              </div>

              <div className="rounded-2xl bg-slate-800/80 backdrop-blur-sm border border-white/10 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-slate-800/80 border-b border-white/10">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="ml-2 text-sm text-gray-400">SDK &amp; CLI</span>
                </div>
                <pre className="p-4 text-sm overflow-x-auto">
                  <code className="text-gray-300">
{`# SDK
const escrow = await client.createEscrow({
  chain: 'SOL', amount: 10,
  depositor_address: 'Alice...',
  beneficiary_address: 'Bob...',
});

# CLI
coinpay escrow create --chain SOL --amount 10 \\
  --depositor Alice... --beneficiary Bob...
coinpay escrow release <id> --token esc_abc...`}
                  </code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* DID Reputation Section */}
      <section className="relative py-24" id="reputation">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-300 text-sm mb-6">
              🆔 Decentralized Identity &amp; Reputation
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              Portable Reputation,{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-fuchsia-400">
                Anchored in Trust
              </span>
            </h2>
            <p className="text-xl text-gray-400 max-w-3xl mx-auto">
              Claim a DID, build reputation through real transactions, and carry your trust score across any platform in the agent economy.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 mb-16">
            {[
              {
                icon: '🔑',
                title: 'Claim Your DID',
                description: 'Get a did:key identity tied to your merchant account. One identity across every platform — no central authority.',
                color: 'violet',
              },
              {
                icon: '📊',
                title: '7-Dimension Trust Vector',
                description: 'Your reputation is computed across Economic, Productivity, Behavioral, Dispute, Recency, Activity, and Cross-platform dimensions.',
                color: 'purple',
              },
              {
                icon: '🌐',
                title: 'Cross-Platform Portability',
                description: 'Platforms like ugig.net submit reputation signals to your DID. Your trust travels with you — not locked in any single app.',
                color: 'fuchsia',
              },
            ].map((feature, index) => (
              <div key={index} className="p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-violet-500/30 transition-colors">
                <div className="text-4xl mb-4">{feature.icon}</div>
                <h3 className="text-xl font-bold text-white mb-3">{feature.title}</h3>
                <p className="text-gray-400 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>

          {/* How Reputation Works */}
          <div className="max-w-4xl mx-auto">
            <div className="p-8 rounded-2xl bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 border border-violet-500/20">
              <h3 className="text-2xl font-bold text-white mb-6 text-center">How It Works</h3>
              <div className="grid sm:grid-cols-4 gap-6">
                {[
                  { step: '1', label: 'Claim DID', desc: 'Create your decentralized identity' },
                  { step: '2', label: 'Transact', desc: 'Complete escrows, gigs, and interactions' },
                  { step: '3', label: 'Build Trust', desc: 'Each action generates a signed receipt' },
                  { step: '4', label: 'Port It', desc: 'Use your reputation on any platform' },
                ].map((item, i) => (
                  <div key={i} className="text-center">
                    <div className="w-10 h-10 rounded-full bg-violet-500/30 text-violet-300 font-bold flex items-center justify-center mx-auto mb-3">
                      {item.step}
                    </div>
                    <h4 className="text-white font-semibold mb-1">{item.label}</h4>
                    <p className="text-gray-400 text-sm">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="text-center mt-12">
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/reputation/did"
                className="px-8 py-4 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-semibold rounded-xl shadow-lg shadow-violet-500/50 hover:shadow-violet-500/70 hover:scale-105 transition-all duration-200"
              >
                Claim Your DID
              </Link>
              <Link
                href="/reputation"
                className="px-8 py-4 bg-white/10 backdrop-blur-sm text-white font-semibold rounded-xl border border-white/20 hover:bg-white/20 hover:scale-105 transition-all duration-200"
              >
                Explore Reputation
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="relative py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              Trusted by Businesses Worldwide
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              See what our customers have to say about CoinPay
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                quote: "CoinPay made integrating crypto payments into our e-commerce platform incredibly simple. The API is well-documented and the support team is responsive.",
                author: "Marcus Chen",
                role: "CTO, TechMart Solutions",
                avatar: "MC",
              },
              {
                quote: "We switched from a custodial solution and couldn't be happier. Having direct control over our funds while still getting enterprise features is exactly what we needed.",
                author: "Sarah Mitchell",
                role: "Founder, Digital Goods Co.",
                avatar: "SM",
              },
              {
                quote: "The automatic fee handling alone saves us hours every week. No more manual calculations or surprise gas fees eating into margins.",
                author: "James Rodriguez",
                role: "Operations Lead, CryptoShop",
                avatar: "JR",
              },
              {
                quote: "Setup took less than 30 minutes. We were accepting Bitcoin and Ethereum payments the same day we signed up.",
                author: "Emily Watson",
                role: "Owner, Artisan Collective",
                avatar: "EW",
              },
              {
                quote: "The webhook system is rock solid. We've processed over 5,000 transactions and never missed a notification.",
                author: "David Park",
                role: "Lead Developer, GameFi Studio",
                avatar: "DP",
              },
              {
                quote: "Finally, a payment gateway that doesn't hold our funds hostage. Transactions go directly to our wallet with full transparency.",
                author: "Lisa Thompson",
                role: "CFO, Nordic Imports",
                avatar: "LT",
              },
            ].map((testimonial, index) => (
              <div
                key={index}
                className="p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-purple-500/30 transition-all duration-300"
              >
                <div className="flex items-center gap-1 mb-4">
                  {[...Array(5)].map((_, i) => (
                    <svg key={i} className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
                <p className="text-gray-300 mb-6 leading-relaxed">&ldquo;{testimonial.quote}&rdquo;</p>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-semibold">
                    {testimonial.avatar}
                  </div>
                  <div>
                    <div className="text-white font-semibold">{testimonial.author}</div>
                    <div className="text-gray-400 text-sm">{testimonial.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Preview */}
      <section className="relative py-24 bg-slate-900/50" id="pricing">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              Simple, Transparent Pricing
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              No hidden fees. Pay only for what you use.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              {
                name: 'Starter',
                price: 'Free',
                description: 'Perfect for testing and small projects',
                features: [
                  '1% transaction + escrow fee',
                  'Up to 100 transactions/month',
                  'All supported chains',
                  'Escrow service included',
                  'Web wallet + CLI',
                  'AI agent /skill.md access',
                ],
              },
              {
                name: 'Professional',
                price: '$49',
                period: '/month',
                description: 'For growing businesses',
                features: [
                  '0.5% transaction + escrow fee',
                  'Unlimited transactions',
                  'Priority support',
                  'Advanced analytics + webhooks',
                  'Escrow with dispute resolution',
                  'GPG-encrypted seed backups',
                ],
                popular: true,
              },
              {
                name: 'Enterprise',
                price: 'Custom',
                description: 'For large-scale operations',
                features: [
                  'Custom transaction fees',
                  'Everything in Professional',
                  'White-label option',
                  'Dedicated account manager',
                  'SLA guarantee',
                  'Custom integrations',
                  'Volume discounts',
                ],
              },
            ].map((plan, index) => (
              <div
                key={index}
                className={`relative p-8 rounded-2xl ${
                  plan.popular
                    ? 'bg-gradient-to-br from-purple-500/20 to-pink-500/20 border-2 border-purple-500'
                    : 'bg-white/5 border border-white/10'
                } backdrop-blur-sm hover:scale-105 transition-all duration-300`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <span className="px-4 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold rounded-full">
                      Most Popular
                    </span>
                  </div>
                )}
                <div className="text-center mb-8">
                  <h3 className="text-2xl font-bold text-white mb-2">{plan.name}</h3>
                  <div className="mb-4">
                    <span className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                      {plan.price}
                    </span>
                    {plan.period && <span className="text-gray-400">{plan.period}</span>}
                  </div>
                  <p className="text-gray-400 text-sm">{plan.description}</p>
                </div>
                <ul className="space-y-4 mb-8">
                  {plan.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-start">
                      <svg
                        className="w-5 h-5 text-purple-400 mr-3 mt-0.5 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-gray-300">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signup"
                  className={`block w-full py-3 px-6 text-center font-semibold rounded-xl transition-all duration-200 ${
                    plan.popular
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/50 hover:shadow-purple-500/70'
                      : 'bg-white/10 text-white border border-white/20 hover:bg-white/20'
                  }`}
                >
                  Get Started
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* API Preview Section */}
      <section className="relative py-24 bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
                Simple <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">API</span>
              </h2>
              <p className="text-xl text-gray-400 mb-8">
                Integrate crypto payments in minutes with our developer-friendly REST API.
              </p>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <span className="text-gray-300">RESTful API with JSON responses</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                  </div>
                  <span className="text-gray-300">Webhook notifications for payment events</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <span className="text-gray-300">HMAC-SHA256 webhook signatures</span>
                </div>
              </div>
              <div className="mt-8">
                <Link
                  href="/docs"
                  className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 font-medium"
                >
                  View API Documentation
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>
            <div className="bg-slate-800/50 rounded-2xl border border-white/10 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-slate-800/80 border-b border-white/10">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="ml-2 text-sm text-gray-400">Create Payment</span>
              </div>
              <pre className="p-4 text-sm overflow-x-auto">
                <code className="text-gray-300">
{`curl -X POST https://api.coinpayportal.com/v1/payments \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 100.00,
    "currency": "USD",
    "cryptocurrency": "ETH",
    "description": "Order #12345",
    "webhook_url": "https://your-site.com/webhook"
  }'`}
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Web Wallet & CLI Section */}
      <section className="relative py-24" id="wallet">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 rounded-full border border-cyan-500/30">
              Web Wallet &amp; CLI
            </span>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mt-4 mb-4">
              Your Keys. Your Coins.
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Non-custodial multi-chain wallet with a full CLI and REST API. Works for humans and AI agents alike.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-12">
            {/* Install & CLI Examples */}
            <div className="space-y-6">
              <h3 className="text-2xl font-bold text-white mb-4">Install</h3>

              {/* SDK install */}
              <div className="rounded-2xl bg-slate-800/80 backdrop-blur-sm border border-white/10 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-slate-800/80 border-b border-white/10">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="ml-2 text-sm text-gray-400">SDK &amp; Payment Gateway CLI</span>
                </div>
                <pre className="p-4 text-sm overflow-x-auto">
                  <code className="text-gray-300">
{`# Install the SDK + coinpay CLI globally
npm install -g @profullstack/coinpay

# Or add to your project
npm install @profullstack/coinpay

# Configure
coinpay config set apiKey YOUR_API_KEY
coinpay config set apiUrl https://coinpayportal.com

# Create a payment
coinpay create --amount 100 --currency USD --crypto ETH`}
                  </code>
                </pre>
              </div>

              {/* Wallet CLI */}
              <div className="rounded-2xl bg-slate-800/80 backdrop-blur-sm border border-white/10 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-slate-800/80 border-b border-white/10">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="ml-2 text-sm text-gray-400">Web Wallet CLI</span>
                </div>
                <pre className="p-4 text-sm overflow-x-auto">
                  <code className="text-gray-300">
{`# Clone and install
git clone https://github.com/profullstack/coinpayportal
cd coinpayportal && pnpm install

# Create a wallet
pnpm coinpay-wallet create --chains BTC,ETH,SOL
✓ Wallet created: d10b1358
  BTC: 1A1zP1eP5QGefi2DMPTfTL...
  ETH: 0xCC3b072391AE7a8d10cF00...
  SOL: 7xKXtg2CW87d97TXJSDpbD...

# Check balances
pnpm coinpay-wallet balance d10b1358

# Send
pnpm coinpay-wallet send d10b1358 \\
  --from 0xCC3b... --to 0x1234... \\
  --chain ETH --amount 0.5

# Sync on-chain deposits
pnpm coinpay-wallet sync d10b1358 --chain BTC

# Transaction history
pnpm coinpay-wallet history d10b1358`}
                  </code>
                </pre>
              </div>
            </div>

            {/* Feature List */}
            <div className="space-y-6">
              <h3 className="text-2xl font-bold text-white mb-4">Features</h3>
              <div className="space-y-4">
                {[
                  {
                    title: '8 Assets, 5 Blockchains',
                    desc: 'BTC, ETH, SOL, POL, BCH, and USDC on Ethereum, Polygon, and Solana.',
                  },
                  {
                    title: 'Signature Authentication',
                    desc: 'Every request signed with your secp256k1 key. No passwords, no tokens to leak.',
                  },
                  {
                    title: 'Background Transaction Finalization',
                    desc: 'Server-side daemon confirms transactions even if you close the browser.',
                  },
                  {
                    title: 'On-Chain Indexer',
                    desc: 'External deposits are automatically detected and synced to your history.',
                  },
                  {
                    title: 'CLI + REST API + Web UI',
                    desc: 'Use the command line, call the API directly, or use the web wallet — your choice.',
                  },
                  {
                    title: 'AI Agent Ready',
                    desc: 'Point your agent to /skill.md and it can create wallets, send payments, and check balances autonomously.',
                  },
                ].map((feature, index) => (
                  <div key={index} className="flex items-start gap-4 p-4 rounded-xl bg-white/5 border border-white/5">
                    <div className="w-8 h-8 shrink-0 rounded-lg bg-cyan-500/20 flex items-center justify-center mt-0.5">
                      <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <h4 className="text-white font-semibold text-sm">{feature.title}</h4>
                      <p className="text-gray-400 text-sm mt-0.5">{feature.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-4 pt-2">
                <Link
                  href="/web-wallet"
                  className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold rounded-xl shadow-lg shadow-cyan-500/30 hover:shadow-cyan-500/50 hover:scale-105 transition-all duration-200 text-sm"
                >
                  Open Web Wallet
                </Link>
                <Link
                  href="/skill.md"
                  className="px-6 py-3 bg-white/10 backdrop-blur-sm text-white font-semibold rounded-xl border border-white/20 hover:bg-white/20 hover:scale-105 transition-all duration-200 text-sm"
                >
                  View skill.md
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="p-12 rounded-3xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 backdrop-blur-sm border border-purple-500/50">
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              Ready to Get Started?
            </h2>
            <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
              Payments, escrow, and wallets — for businesses, freelancers, and AI agents. Start accepting crypto in minutes.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/signup"
                className="px-8 py-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl shadow-lg shadow-purple-500/50 hover:shadow-purple-500/70 hover:scale-105 transition-all duration-200"
              >
                Create Free Account
              </Link>
              <Link
                href="/contact"
                className="px-8 py-4 bg-white/10 backdrop-blur-sm text-white font-semibold rounded-xl border border-white/20 hover:bg-white/20 hover:scale-105 transition-all duration-200"
              >
                Contact Sales
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}