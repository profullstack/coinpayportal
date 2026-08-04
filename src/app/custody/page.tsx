import type { Metadata } from 'next';
import Link from 'next/link';
import { isMultisigEnabled } from '@/lib/multisig';

// Rendered per-request: the multisig claims below are only true when the feature
// flag is on, and a statically cached page would keep asserting them after it
// changed in either direction.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Who Holds Your Money | CoinPay',
  description:
    'Exactly who can move funds at each step of CoinPay, what happens to your money if CoinPay shuts down, and who decides disputes. Per-product custody, stated plainly.',
};

/**
 * Custody disclosure.
 *
 * This page exists because "non-custodial" is not true of CoinPay as a whole —
 * it is true of some surfaces and false of others. Every claim here is meant to
 * be checkable against the code, so if you change custody behaviour, change this
 * page in the same commit:
 *
 *   - payment forwarding window ... src/lib/payments/forwarding.ts
 *   - escrow key custody ......... src/lib/escrow/service.ts (platform HD address)
 *   - 2-of-3 multisig escrow ..... src/lib/multisig/engine.ts
 *   - expiry auto-refund/release . src/app/api/cron/monitor-payments/escrow-monitor.ts
 *   - web wallet key handling .... src/lib/web-wallet/keys.ts (keys never sent to server)
 */

type Custody = 'none' | 'window' | 'full' | 'unavailable';

const custodyRows = (multisigEnabled: boolean): Array<{
  product: string;
  who: string;
  custody: Custody;
}> => [
  {
    product: 'Web wallet',
    who: 'You, and only you. The seed is generated and encrypted in your browser and is never sent to our servers.',
    custody: 'none',
  },
  {
    product: 'On-chain payments',
    who: 'You, after a short window. Customers pay to an address CoinPay derives, and our monitor forwards the balance to your wallet minus the fee. Between confirmation and forwarding, our infrastructure holds the key.',
    custody: 'window',
  },
  {
    product: 'Escrow — default (custodial)',
    who: 'CoinPay, for the entire escrow. Funds sit at an address we derive from our own seed, and we move them when the depositor releases, a refund is requested, or an arbiter resolves a dispute.',
    custody: 'full',
  },
  {
    product: 'Escrow — 2-of-3 multisig',
    who: multisigEnabled
      ? 'Any two of depositor, beneficiary, and CoinPay. We hold one key of three, so we cannot move your funds alone.'
      : 'Not currently enabled. The 2-of-3 model is built and in the codebase, but it is switched off on this deployment, so you cannot create one today. Every escrow created right now is custodial.',
    custody: multisigEnabled ? 'none' : 'unavailable',
  },
  {
    product: 'Lightning wallet',
    who: 'CoinPay, until you withdraw. Lightning balances live on our node, not under your seed phrase.',
    custody: 'full',
  },
];

const CUSTODY_LABEL: Record<Custody, { text: string; className: string }> = {
  none: {
    text: 'We never hold it',
    className: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  },
  window: {
    text: 'We hold it briefly',
    className: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  },
  full: {
    text: 'We hold it',
    className: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  },
  unavailable: {
    text: 'Not available yet',
    className: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
  },
};

export default function CustodyPage() {
  const multisigEnabled = isMultisigEnabled();
  const rows = custodyRows(multisigEnabled);

  return (
    <div className="container mx-auto px-4 py-16 max-w-4xl">
      <h1 className="text-4xl font-bold mb-4 text-white">Who holds your money</h1>
      <p className="text-lg text-gray-300 mb-10">
        CoinPay is not one custody model, so we do not describe it with one word. Some parts of
        CoinPay never touch your funds. Some hold them for about a minute. Some hold them until
        someone tells us to let go. Below is which is which, what happens to your money if this
        company disappears, and who decides when two parties disagree.
      </p>

      {/* ── 1. Who holds it right now ─────────────────────────── */}
      <section className="mb-14">
        <h2 className="text-2xl font-bold mb-4 text-white">1. Who holds the money right now</h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/20">
                <th className="py-3 pr-4 text-white font-semibold align-bottom">Product</th>
                <th className="py-3 pr-4 text-white font-semibold align-bottom">
                  Who can move the funds
                </th>
                <th className="py-3 text-white font-semibold align-bottom whitespace-nowrap">
                  Custody
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.product} className="border-b border-white/10 align-top">
                  <td className="py-4 pr-4 text-white font-medium">{row.product}</td>
                  <td className="py-4 pr-4 text-gray-300">{row.who}</td>
                  <td className="py-4">
                    <span
                      className={`inline-block whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${
                        CUSTODY_LABEL[row.custody].className
                      }`}
                    >
                      {CUSTODY_LABEL[row.custody].text}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-white/15 bg-white/5 p-5 mt-6">
          <p className="text-gray-300">
            <strong className="text-white">Which of these apply to you.</strong> Escrow, Lightning,
            and the web wallet are opt-in — most merchants never enable them, and if you don&apos;t,
            the custodial rows above are not part of your setup. The payment forwarding window is
            not opt-in. It applies to every on-chain payment CoinPay processes, so it is the one row
            that describes you no matter how you use the product.
          </p>
        </div>

        <p className="text-gray-300 mt-6">
          That window is worth being precise about, because &ldquo;funds go directly to your
          wallet&rdquo; is the kind of phrase that sounds like nothing touches them. Something does.
          Every payment is received at an address we derive from our own seed, and our monitor —
          which runs every minute — forwards the balance on to you minus the fee. There is no mode
          where a customer pays your wallet directly. In the normal case you are holding the funds
          well under a minute after confirmation. If a forward fails — a bad RPC, a gas shortfall —
          it retries, and the money stays at our address until it succeeds. During that time we
          could move it. We do not, but you are trusting us, not math.
        </p>

        <p className="text-gray-300 mt-4">
          Default escrow is the same trust, held for longer and on purpose. Money sits at our
          address for the length of the job.{' '}
          {multisigEnabled ? (
            <>
              If that is not a trade you want to make, create the escrow as{' '}
              <span className="text-white font-medium">2-of-3 multisig</span> instead: we hold one
              key of three, which is enough to break a tie and not enough to take anything.
            </>
          ) : (
            <>
              The 2-of-3 multisig model that would avoid this is built but not switched on here, so
              there is currently no way to create an escrow that CoinPay cannot unilaterally move.{' '}
              <span className="text-white font-medium">
                If that is not an acceptable trade, do not use escrow for that money.
              </span>{' '}
              We would rather say that than let you assume an option exists.
            </>
          )}
        </p>
      </section>

      {/* ── 2. If we disappear ────────────────────────────────── */}
      <section className="mb-14">
        <h2 className="text-2xl font-bold mb-4 text-white">
          2. What happens if CoinPay disappears tomorrow
        </h2>

        <p className="text-gray-300 mb-4">
          Split by whether your funds depend on us being alive.
        </p>

        <h3 className="text-lg font-semibold text-white mt-6 mb-2">You are fine without us</h3>
        <ul className="list-disc list-inside text-gray-300 space-y-2 mb-6">
          <li>
            <strong className="text-white">Web wallet.</strong> Your seed is in your browser and we
            never had it. Export it, import it into any compatible wallet, and your funds are
            unaffected by anything that happens to this company. Export it{' '}
            <em>before</em> you need it — clearing site data destroys the only copy we cannot help
            you replace.
          </li>
          <li>
            <strong className="text-white">Money already forwarded.</strong> Once a payment reaches
            your wallet it is yours, in your custody, with no ongoing dependency on CoinPay.
          </li>
          {multisigEnabled && (
            <li>
              <strong className="text-white">2-of-3 multisig escrow.</strong> The depositor and the
              beneficiary together are two of three signers. They can settle the escrow between
              themselves without CoinPay ever signing. This is the only product here where a dispute
              about our absence has a purely mechanical answer.
            </li>
          )}
        </ul>

        {!multisigEnabled && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 mb-6">
            <p className="text-gray-300">
              <strong className="text-white">
                The escape hatch is not currently open.
              </strong>{' '}
              2-of-3 multisig escrow — where the depositor and beneficiary could settle without us —
              is implemented but switched off on this deployment. Until it is enabled, every escrow
              is custodial, and the answer to &ldquo;what if you disappear&rdquo; for escrowed funds
              is that you would be depending on us entirely. That is a real limitation and we are
              not going to bury it under a feature that is not turned on.
            </p>
          </div>
        )}

        <h3 className="text-lg font-semibold text-white mt-6 mb-2">You are depending on us</h3>
        <ul className="list-disc list-inside text-gray-300 space-y-2 mb-6">
          <li>
            <strong className="text-white">Default custodial escrow</strong>, funds mid-forward, and{' '}
            <strong className="text-white">Lightning balances</strong> are all held at addresses
            derived from CoinPay&apos;s own seed. If our infrastructure and our keys are gone, there
            is no third party holding a backup for you and no on-chain mechanism that releases the
            funds without us. Recovery would depend entirely on Profullstack, Inc. being able and
            willing to act.
          </li>
          <li>
            We are not a bank. There is no deposit insurance, no segregated trust account, and no
            regulator you can escalate to for these balances.
          </li>
        </ul>

        <div className="rounded-xl border border-white/15 bg-white/5 p-5">
          <p className="text-gray-300">
            <strong className="text-white">Open source helps, but not the way people assume.</strong>{' '}
            CoinPay is MIT-licensed and the full server is public, so you can audit exactly what we
            do with keys and you could run the whole stack yourself. What that does{' '}
            <em>not</em> do is give you our keys. Reading the code tells you the custodial escrow
            model is honest about what it is; it does not make it non-custodial. Treat the licence
            as a transparency guarantee, not a recovery plan.
          </p>
        </div>

        <p className="text-gray-300 mt-6">
          The practical advice, which is against our interest to give and true anyway: keep working
          balances small, withdraw Lightning to on-chain for anything you would miss, and{' '}
          {multisigEnabled ? (
            <>
              use multisig escrow for amounts where our continued existence is not something you
              want to bet on.
            </>
          ) : (
            <>
              do not put anything into escrow that you could not absorb losing if this company
              stopped existing tomorrow.
            </>
          )}
        </p>
      </section>

      {/* ── 3. Disputes ───────────────────────────────────────── */}
      <section className="mb-14">
        <h2 className="text-2xl font-bold mb-4 text-white">
          3. When there is a dispute, who decides and on what evidence
        </h2>

        <p className="text-gray-300 mb-4">
          Either the depositor or the beneficiary can open a dispute on a funded escrow. What
          happens next depends on who was named arbiter when the escrow was created.
        </p>

        <ul className="list-disc list-inside text-gray-300 space-y-2 mb-6">
          <li>
            <strong className="text-white">If you named an arbiter</strong> — a third party you both
            chose — that party decides, and CoinPay executes what they decide.
          </li>
          <li>
            <strong className="text-white">If you did not name one, CoinPay decides.</strong> That is
            the default, it applies to most escrows, and it means the company operating the escrow
            is also refereeing it.
          </li>
        </ul>

        <p className="text-gray-300 mb-4">
          The evidence is whatever is attached to the escrow: the job description, milestones and
          deliverables written into its metadata at creation, the stated reason for the dispute, and
          the escrow&apos;s event log — every state change, timestamped, including the on-chain
          deposit and any settlement attempts. We can see when money arrived and what the two of you
          said the work was. We cannot see whether the work was actually good.
        </p>

        <p className="text-gray-300 mb-4">
          Two limits we would rather state than have you discover:
        </p>
        <ul className="list-disc list-inside text-gray-300 space-y-2 mb-6">
          <li>
            <strong className="text-white">There is no published response time</strong> and no
            formal evidence standard. A CoinPay-arbitrated dispute is a human reading the metadata
            and making a judgement call.
          </li>
          <li>
            <strong className="text-white">There is no appeal.</strong> When CoinPay is the arbiter,
            CoinPay&apos;s decision is final and there is no external body to escalate to.
          </li>
        </ul>

        <p className="text-gray-300 mb-4">
          {multisigEnabled ? (
            <>
              Two things do work in your favour. On a{' '}
              <strong className="text-white">
                2-of-3 multisig escrow the arbiter cannot simply take the money
              </strong>{' '}
              — they can only propose an outcome, which still needs a second signature from the
              depositor or the beneficiary. And a funded escrow cannot sit forever:
            </>
          ) : (
            <>
              One thing does work in your favour. A funded escrow cannot sit forever:
            </>
          )}{' '}
          at expiry it settles automatically. By default it{' '}
          <strong className="text-white">refunds the depositor</strong>; if the escrow was created
          with auto-release enabled, it pays the beneficiary instead. Either way the funds move
          without anyone needing us to intervene.
        </p>

        <p className="text-gray-300">
          If a dispute is significant enough that &ldquo;the company decides, with no appeal&rdquo;
          is not an acceptable answer,{' '}
          {multisigEnabled ? (
            <>
              name a mutually trusted arbiter at creation time and use the multisig model. Those
              options exist precisely because our default answer to this question is weaker than it
              should be.
            </>
          ) : (
            <>
              name a mutually trusted arbiter at creation time — that is the only lever currently
              available, since the multisig model that would also stop the arbiter moving funds
              alone is not enabled here. Our default answer to this question is weaker than it
              should be, and we would rather you knew that before depositing than after.
            </>
          )}
        </p>
      </section>

      {/* ── Footer links ──────────────────────────────────────── */}
      <section className="border-t border-white/10 pt-8">
        <p className="text-gray-400">
          Related:{' '}
          <Link href="/terms" className="text-purple-400 hover:text-purple-300">
            Terms of Service
          </Link>
          {' · '}
          <Link href="/docs" className="text-purple-400 hover:text-purple-300">
            Documentation
          </Link>
          {' · '}
          <a
            href="https://github.com/profullstack/coinpayportal"
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-400 hover:text-purple-300"
          >
            Source code
          </a>
        </p>
        <p className="text-gray-500 text-sm mt-3">
          Found something on this page that does not match how CoinPay actually behaves? That is a
          bug we want reported — open an issue against the repository.
        </p>
      </section>
    </div>
  );
}
