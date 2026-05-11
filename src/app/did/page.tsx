import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Agentic Identity — Decentralized Identifiers for Humans & AI Agents',
  description:
    'Cryptographic identities for humans, AI agents, and services. Verifiable credentials, delegated authority, revocation, and portable reputation — open, signed, and yours.',
};

const PILLARS = [
  {
    icon: '🆔',
    title: 'Cryptographic Identity',
    body: 'ed25519 keypairs minted as did:key. One principal DID per human; unlimited agent and service DIDs. Ephemeral or persistent — your choice per workload.',
  },
  {
    icon: '🤝',
    title: 'Delegated Authority',
    body: 'Authorize an AI agent to act on your behalf with scoped, time-bound, signed credentials. No shared secrets. Revoke any agent in one click.',
  },
  {
    icon: '📜',
    title: 'Verifiable Credentials',
    body: 'Receipts, reputation, and attestations are issued as signed VCs. Anyone with the public key can verify — no platform required.',
  },
  {
    icon: '🚫',
    title: 'Revocation Registry',
    body: 'Every credential has a public revocation list. Compromised agent? Expired contract? Revoke the credential and consumers see it immediately.',
  },
  {
    icon: '🔍',
    title: 'Tamper-Evident Audit',
    body: 'Every economic action — escrow, receipt, settlement — is signed by both parties and indexed against the agent DID. Audit trail by construction.',
  },
  {
    icon: '🌐',
    title: 'Portable Reputation',
    body: 'Your DID and reputation are not locked to CoinPayPortal. Reputation queries are public API. If we shut down tomorrow, your history survives.',
  },
];

const USE_CASES = [
  {
    title: 'AI agents that handle money',
    body: 'Give your trading bot, refund agent, or payment automation its own DID. Issue a scoped delegation. Track every action it takes — and revoke when it goes wrong.',
  },
  {
    title: 'Marketplaces that need trust',
    body: 'Sellers carry portable reputation across platforms. Buyers verify settlement history, dispute rate, and acceptance rate before transacting. No fake reviews — scores are backed by real escrow.',
  },
  {
    title: 'Freelancers & service providers',
    body: 'Your reputation follows you. Quote a client, settle the escrow, and the receipt is signed into your DID forever. The next platform can read it.',
  },
  {
    title: 'Multi-agent systems',
    body: 'Each agent in the swarm gets an ephemeral DID with narrow scope. Spawn, delegate, run, revoke. Full audit trail across orchestrators.',
  },
];

const COMPARE = [
  { feature: 'Cryptographic agent identity', us: true, oauth: false, apikey: false },
  { feature: 'Delegated, scoped authority', us: true, oauth: true, apikey: false },
  { feature: 'Revocable per-agent', us: true, oauth: true, apikey: 'sort of' },
  { feature: 'Verifiable without us', us: true, oauth: false, apikey: false },
  { feature: 'Portable across platforms', us: true, oauth: false, apikey: false },
  { feature: 'Signed audit trail', us: true, oauth: false, apikey: false },
  { feature: 'Economic reputation built-in', us: true, oauth: false, apikey: false },
];

function CheckCell({ value }: { value: boolean | string }) {
  if (value === true) return <span className="text-green-400 text-lg">✓</span>;
  if (value === false) return <span className="text-gray-600 text-lg">—</span>;
  return <span className="text-yellow-400 text-xs">{value}</span>;
}

export default function DidLandingPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-gray-800">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-900/20 via-gray-950 to-fuchsia-900/20 pointer-events-none" />
        <div className="container mx-auto px-4 py-20 max-w-5xl relative">
          <div className="inline-block px-3 py-1 rounded-full bg-violet-500/20 border border-violet-500/30 text-violet-300 text-xs font-medium mb-6">
            Agentic Identity Framework
          </div>
          <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
            Cryptographic identity for{' '}
            <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
              humans, AI agents, and services
            </span>
          </h1>
          <p className="text-lg md:text-xl text-gray-400 mb-8 max-w-3xl">
            Mint a Decentralized Identifier. Issue scoped, revocable authority to AI agents.
            Earn portable reputation from real economic activity. All open, all signed, all yours —
            no shared secrets, no platform lock-in.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/reputation/did"
              className="px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium transition"
            >
              Claim Your DID →
            </Link>
            <Link
              href="/reputation"
              className="px-6 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white rounded-lg font-medium transition"
            >
              See It In Action
            </Link>
            <Link
              href="/docs"
              className="px-6 py-3 bg-transparent hover:bg-gray-800 border border-gray-700 text-gray-300 rounded-lg font-medium transition"
            >
              Read the Docs
            </Link>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="container mx-auto px-4 py-16 max-w-6xl">
        <h2 className="text-3xl font-bold mb-2 text-center">What you get</h2>
        <p className="text-gray-400 text-center mb-12 max-w-2xl mx-auto">
          A complete identity stack, built from primitives that already work — VCs, ed25519,
          public revocation, signed receipts.
        </p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {PILLARS.map((p) => (
            <div
              key={p.title}
              className="bg-gray-900/60 border border-gray-800 rounded-xl p-6 hover:border-violet-500/40 transition"
            >
              <div className="text-3xl mb-3">{p.icon}</div>
              <h3 className="text-lg font-bold mb-2">{p.title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Use cases */}
      <section className="bg-gray-900/40 border-y border-gray-800">
        <div className="container mx-auto px-4 py-16 max-w-6xl">
          <h2 className="text-3xl font-bold mb-2 text-center">Who it&apos;s for</h2>
          <p className="text-gray-400 text-center mb-12">If anything you build needs to act with authority — read this.</p>
          <div className="grid md:grid-cols-2 gap-5">
            {USE_CASES.map((u) => (
              <div key={u.title} className="bg-gray-950/80 border border-gray-800 rounded-xl p-6">
                <h3 className="text-lg font-bold mb-2 text-violet-300">{u.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{u.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="container mx-auto px-4 py-16 max-w-5xl">
        <h2 className="text-3xl font-bold mb-12 text-center">How delegation works</h2>
        <div className="space-y-4">
          {[
            { n: 1, title: 'You mint your principal DID', body: 'A did:key backed by ed25519. Stored encrypted on our side, exportable any time. This is your root identity.' },
            { n: 2, title: 'Your AI agent generates its own keypair', body: 'The agent has its own DID, locally. Its private key never touches our server. You never share yours with it.' },
            { n: 3, title: 'You issue a DelegatedAuthorityCredential', body: 'A signed VC that says: "Principal X authorizes Agent Y for scopes [escrow:settle, reputation:submit_receipt] until 2026-12-31." Stored in the credential registry, publicly verifiable.' },
            { n: 4, title: 'The agent presents the credential', body: 'When the agent calls our API, it includes the credential plus a signature from its own key. We verify the chain: signature → agent DID → delegation → principal DID. No shared secret in sight.' },
            { n: 5, title: 'You revoke at will', body: 'Compromise? Project ended? Hit revoke. The revocation registry updates publicly, and the agent loses authority on the next request.' },
          ].map((s) => (
            <div key={s.n} className="flex gap-5 items-start bg-gray-900/40 border border-gray-800 rounded-xl p-5">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-violet-600/30 border border-violet-500/40 flex items-center justify-center font-bold text-violet-300">
                {s.n}
              </div>
              <div>
                <h3 className="font-bold mb-1">{s.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison */}
      <section className="bg-gray-900/40 border-y border-gray-800">
        <div className="container mx-auto px-4 py-16 max-w-4xl">
          <h2 className="text-3xl font-bold mb-2 text-center">Compared to what you have now</h2>
          <p className="text-gray-400 text-center mb-10">API keys and OAuth weren&apos;t built for agents that move money.</p>
          <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/60">
                <tr>
                  <th className="text-left p-4 font-semibold">Feature</th>
                  <th className="p-4 font-semibold text-violet-300">CoinPayPortal DID</th>
                  <th className="p-4 font-semibold text-gray-400">OAuth</th>
                  <th className="p-4 font-semibold text-gray-400">API Keys</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((row, i) => (
                  <tr key={row.feature} className={i % 2 ? 'bg-gray-900/30' : ''}>
                    <td className="p-4 text-gray-300">{row.feature}</td>
                    <td className="p-4 text-center"><CheckCell value={row.us} /></td>
                    <td className="p-4 text-center"><CheckCell value={row.oauth} /></td>
                    <td className="p-4 text-center"><CheckCell value={row.apikey} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="container mx-auto px-4 py-20 max-w-3xl text-center">
        <h2 className="text-3xl md:text-4xl font-bold mb-4">Mint a DID in 10 seconds</h2>
        <p className="text-gray-400 mb-8 text-lg">
          Free. No credit card. Generates an ed25519 keypair, mints a did:key, and you&apos;re live.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link
            href="/reputation/did"
            className="px-8 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium transition"
          >
            Claim Your DID →
          </Link>
          <Link
            href="/reputation"
            className="px-8 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white rounded-lg font-medium transition"
          >
            Browse Reputation Network
          </Link>
        </div>
      </section>
    </div>
  );
}
