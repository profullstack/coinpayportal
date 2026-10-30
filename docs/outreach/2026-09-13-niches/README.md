# CoinPay: 10 adjacent markets and an outreach worklist

Research date: **13 September 2026**. Product baseline: `85835cb`.
Prepared for internal review from the supplied merchant conversation and current first-party sources. This package contains **10 distinct niches, 10 verified company accounts, and 10 individualized message drafts**. No messages, form submissions, paid enrichment, campaign enrollment or purchases were made.

**Start discovery with eSIM refills, independent hosting and paid APIs.** They offer concrete payment-to-delivery workflows that match CoinPay's implementation. Supplement and adult-wellness retail preserve the original interest in underserved categories, but require an eligible product and destination scope. Privacy VPNs and bullion have visible crypto adoption and stronger incumbents, so they rank lower.

“Underserved” is a hypothesis to qualify, not a claim that each company lacks processing. Most known crypto merchants already have a gateway. The opportunity is an unresolved checkout, reconciliation or programmatic purchase task.

## What the original conversation tells us

The merchant already had a working crypto flow, described its monitoring tools as free, and declined. The initial offer therefore addressed a solved problem. It did not establish a missing coin, recurring manual work, abandoned orders or buyer demand for agent purchases. A generic “have you considered crypto?” sequence will repeat that result.

Treat this account as closed for this initiative. The local [suppression record](suppression.json) preserves the domain without copying the private email, individual contact details or conversation. Apply that record and the existing CRM's suppression list before any future enrollment.

The agent follow-up also needs correction: **Etherscan explicitly offers agents access through MCP, CLI and skills.** Its free data API is real; its published free tier allows 3 calls/second and up to 100,000 calls/day on selected chains. Claiming Etherscan cannot work with agents would be inaccurate. [Etherscan introduction](https://docs.etherscan.io/introduction), [rate limits](https://docs.etherscan.io/rate-limits).

CoinPay's defensible distinction is the implemented commerce workflow: create a payment or priced API offer, associate it with an invoice/resource, handle payment state, and let the merchant's integration deliver the purchased item. An agent's ability to read a blockchain does not by itself define a store's order API, shipping eligibility, tax, stock or fulfillment. CoinPay also does not supply those merchant-specific pieces automatically.

## Product facts that constrain the pitches

| Topic | Verified basis and usable positioning |
| --- | --- |
| Hosted checkout and merchant-wallet forwarding | Payment and invoice routes plus working billing plugins exist. On ordinary hosted on-chain checkout, CoinPay holds the receiving key during forwarding; it is not an entirely non-custodial flow. See [custody source](../../../src/app/custody/page.tsx), [public custody disclosure](https://coinpayportal.com/custody), and [WHMCS behavior](../../../plugins/whmcs/README.md). |
| Pricing | Hosted on-chain fee constants are Starter 1%, Professional 0.5%. Live public plan API returned $0/month and $49/month ($490/year), respectively. Network costs are additional; these percentages are not an all-in landed cost. See [fee implementation](../../../src/lib/payments/fees.ts), [subscription prices](../../../src/lib/subscriptions/service.ts), and [public plan endpoint](https://coinpayportal.com/api/subscription-plans). First-touch drafts intentionally omit price quotations. |
| Plan discrepancy | The live plan endpoint reports unlimited transactions for both plans, matching the [June migration](../../../supabase/migrations/20260624113709_remove_transaction_limits.sql). Homepage, FAQ and static feature data still mention 100/month for Starter. Custom webhooks are false for Starter and true for Professional in the live response. Confirm the necessary entitlement before offering an automated integration; do not promise free custom webhooks. |
| Integrations | The [plugin status table](../../../plugins/README.md) marks WooCommerce, WHMCS and FOSSBilling working. Shopify, EDD and most other adapters are stubs. A shop's platform was not established merely from its niche or URL; verify it before promising a plugin. WHMCS refund automation is explicitly incomplete. |
| Agent payments | SDK x402 middleware, verify/settle endpoints and agent registration exist. Start an API pilot with a specifically supported EVM/USDC v2 offer and validate that exact flow. [SDK](../../../packages/sdk/src/x402.js), [settlement](../../../src/app/api/x402/settle/route.ts), [v2 implementation](../../../src/lib/x402/settle-v2.ts). Do not promise every advertised asset works identically on every product. |
| Spending limits | Registered-agent per-payment, rolling-day and lifetime limits are enforced at CoinPay x402 v2 settlement. They do not constrain an agent broadcasting directly with its own private key. [Agent migration and explicit limits](../../../supabase/migrations/20260906060000_agent_wallets.sql), [agent API](../../../src/app/api/v1/agents/route.ts). |
| x402 commercial terms | Settlement source explicitly says the x402 rail pays the merchant directly and does not collect the platform fee it currently computes/reports. Resolve the fee model and deployed behavior before selling a paid API rollout. Do not simply reuse the hosted-checkout 1% claim or promise free x402 service. |
| Other capabilities | No verified promise of universal autonomous shopping, automatic debits from arbitrary wallets, Monero checkout, guaranteed anonymity, turnkey tax/merchant-of-record coverage, automatic fiat conversion or acceptance of every merchant category. Public custody disclosure currently says multisig escrow is disabled on that deployment; do not sell it as available. |

The [live homepage](https://coinpayportal.com/) and documentation contain broader claims than some implementation paths support. This report uses narrower product-specific statements. Code inspection and read-only public endpoints establish the baseline; no production transaction or deployment audit was performed.

## Prioritized niches

Ranks are analyst judgments. Scores add observed payment friction, crypto-demand evidence, integration fit and reachable business ownership (each 0–3), then subtract incumbent switching cost (0–2). The component values are in [targets.json](targets.json); they are not market-size estimates or forecasts.

| Rank | Niche | Initial account | Score | Main reason to investigate |
| --- | --- | --- | --- | --- |
| 1 | Travel eSIM and mobile-data refills | Keepgo | 9 | Documented crypto payment exceptions; a refill is a bounded deliverable. |
| 2 | Independent hosting and domains | OrangeWebsite | 8 | Existing crypto buyers and implemented CoinPay billing adapters. |
| 3 | Commercial data APIs and agent tools | Geoapify | 8 | Published MCP tools make a scoped agent-payment experiment concrete. |
| 4 | Authorized cybersecurity training | PentesterLab | 7 | Reachable operator, fixed-duration digital access. |
| 5 | Lawful dietary supplements | Nootropics Depot | 7 | Documented product/region payment limits and verification work. |
| 6 | Adult wellness retail | Spectrum Boutique | 7 | Customer billing preferences; a distinct retail catalog. |
| 7 | GPU inference and compute credits | Runpod | 6 | Existing crypto deposits and a possible agent-credit workflow. |
| 8 | First-party audio software/sound libraries | u-he | 5 | Digital delivery, subject to existing commerce-provider responsibilities. |
| 9 | Privacy-focused VPN subscriptions | IVPN | 5 | Crypto demand established, but self-hosted incumbent is a poor replacement target. |
| 10 | Physical bullion and collectible-coin dealers | JM Bullion | 4 | Proven crypto use; strong incumbent and more settlement requirements. |

### 1. Travel eSIM and mobile-data refills

**Account evidence:** Keepgo accepts crypto refills. Its terms publish a crypto surcharge and direct underpaying customers to support. These are concrete discovery topics; they do not establish that CoinPay would be cheaper after every cost. [Refill payment methods](https://faq.keepgo.com/kb/keepgo-esim/what-payment-methods-may-i-use-to-recharge-keepgo-esim), [terms](https://www.keepgo.com/pages/terms-of-service).

**Target:** payments lead or eSIM partnerships through [general inquiries](https://www.keepgo.com/pages/contact-us). Test one refill SKU and duplicate-safe account crediting. Ask for exception counts, actual surcharge scope and net economics.

**Short pitch:** “You already accept crypto. Could one refill pilot help compare payment exception handling and total cost?”

### 2. Independent hosting, VPS and domain services

**Account evidence:** OrangeWebsite explicitly identifies BitPay and CoinPayments and describes automated invoice marking. Do not allege it manually reconciles transactions. [Crypto hosting](https://orangewebsite.com/company/bitcoin-crypto-currency).

**Target:** billing lead/owner through the [sales department](https://secure.orangewebsite.com/submitticket.php). Confirm WHMCS/FOSSBilling version before selecting the working gateway. Qualify maintenance effort or a missing asset; stop if the existing flow meets requirements. Limit the proposal to legitimate hosting and the provider's acceptable-use rules.

**Short pitch:** “If your billing stack matches, we could compare one invoice flow and the cost of maintaining another gateway.”

### 3. Commercial data APIs and agent tools

**Account evidence:** Geoapify publishes MCP tools and API credit pricing. That makes a paid-agent offer plausible, but does not prove demand for crypto or a billing gap. [MCP documentation](https://apidocs.geoapify.com/docs/mcp/), [pricing and Contact Us control](https://www.geoapify.com/pricing/).

**Target:** API product owner. Prototype one priced request or credit pack, keeping data licensing, attribution and account checks. Require settlement success and agreed x402 economics before paid use.

**Short pitch:** “Could we test one separately priced API offer for agents alongside your existing credits?”

### 4. Authorized cybersecurity labs and training

**Account evidence:** PentesterLab is an operator-led training business; its terms describe a manual invoice path following failed automatic billing. This supports fixed-term access as a pilot, not a claim about a widespread failed-payment problem. [About](https://pentesterlab.com/about), [terms](https://pentesterlab.com/terms).

**Target:** founder/platform owner through the [published support route](https://pentesterlab.com/exercises). Establish actual requests from eligible wallet-paying learners. Sell access to authorized labs; avoid attack-for-hire or access to third-party systems.

**Short pitch:** “Would a one-time wallet purchase linked to confirmed training access serve an existing learner request?”

### 5. Lawfully marketed dietary supplements

**Account evidence:** Nootropics Depot describes payment options that depend on product and region and a manual card-verification policy. Its published accepted-payment list does not list crypto; that absence alone does not prove no private option exists. [Payment methods](https://support.nootropicsdepot.com/article/36-accepted-forms-of-payment), [verification](https://nootropicsdepot.com/payment-verification/).

**Target:** ecommerce operations through [official contact instructions](https://support.nootropicsdepot.com/article/43-how-do-i-contact-nootropics-depot). Review exact products, claims and permitted destinations. Exclude peptides, unapproved drugs and controlled substances from this worklist. “Supplement” labeling does not establish eligibility; FDA notes that supplements are not approved for safety and effectiveness before marketing. [FDA consumer information](https://www.fda.gov/food/dietary-supplements/information-consumers-using-dietary-supplements).

**Short pitch:** “For products and destinations you already permit, would a reviewed crypto-checkout pilot be useful?”

### 6. Adult wellness and intimate-care retail

**Account evidence:** Spectrum Boutique's FAQ discusses discreet billing and limits on card-statement descriptions. There is no evidence here that the company was rejected by an acquirer. [Retail FAQ](https://spectrumboutique.com/pages/faqs).

**Target:** owner/ecommerce lead through the [contact page](https://spectrumboutique.com/pages/contact). Scope to lawful retail products and adults. Verify storefront architecture; do not assume a working native Shopify integration. Wallet payment is not an anonymity guarantee because public-chain activity can be visible.

**Short pitch:** “If customers ask for wallet payment, could we evaluate optional checkout for a small set of eligible retail products?”

### 7. GPU inference and compute-credit services

**Account evidence:** Runpod already accepts crypto deposits and operates a credit-balance model. Its documentation also describes verification requirements. [Billing overview](https://docs.runpod.io/accounts-billing/billing).

**Target:** payments product/platform partnerships via [contact sales](https://www.runpod.io/contact). Examine an authorized agent purchasing bounded compute credit. Connect payment to the right account and prevent duplicate credits. This requires custom integration and does not replace GPU metering.

**Short pitch:** “Would an authorized agent buying a bounded credit amount add something your existing deposit flow does not?”

### 8. First-party audio software and sound libraries

**Account evidence:** u-he sells licenses and soundsets; its support page directs checkout to Cleverbridge. An incumbent commerce service may handle tax, refunds and other obligations beyond payments. [Support and checkout information](https://u-he.com/support/).

**Target:** ecommerce/business development through the general question route on that page. Qualify direct-wallet demand and existing contract constraints before designing license issuance. Scope to authorized first-party products, not cracked software or unauthorized resale.

**Short pitch:** “If direct customers request wallet payments, could we assess a small checkout-to-license pilot that fits your commerce contract?”

### 9. Privacy-focused VPN subscriptions

**Account evidence:** IVPN operates its own Bitcoin/BTCPay and Monero infrastructure. This is evidence of crypto demand and a substantial reason it may reject a hosted gateway. [Payment methods](https://www.ivpn.net/knowledgebase/general/what-payment-methods-do-you-accept).

**Target:** founder/payments engineering through [official contact](https://www.ivpn.net/contactus/). Ask only about an unmet supported-asset need and a separate fixed-term purchase. State hosted-checkout custody plainly. Do not offer unsupported Monero or use anonymity as the pitch.

**Short pitch:** “Are customers asking for a stablecoin rail you do not want to operate yourself, and would hosted custody be acceptable?”

### 10. Physical bullion and collectible-coin dealers

**Account evidence:** JM Bullion's support article identifies BitPay for Bitcoin payments. It is a lower-priority discovery account with an established provider, not a merchant that needs to learn crypto exists. [Bitcoin payment support](https://help.jmbullion.com/article/118-how-do-i-pay-with-bitcoin).

**Target:** payments/ecommerce operations through [payment contact](https://www.jmbullion.com/contact/payment/). Qualify one unresolved exception and review quote expiry, settlement currency, verification, returns and physical delivery. Do not promise to match BitPay's entire service or make investment-return claims.

**Short pitch:** “Is there one unresolved crypto-checkout exception worth assessing with a limited second rail?”

## Answering “we already use Etherscan for free”

For a new prospect that raises this objection, use:

> That makes sense. Etherscan is a useful data layer and can work with agents too. CoinPay would need to earn its fee through a checkout or fulfillment task you still have to maintain. Is there a payment-to-order step that causes work today? If your current flow covers it, there may be no reason to add us.

Do not send this as another follow-up to the account that already declined.

For an interested prospect, compare the full workflow: chain lookup; invoice/order correlation; amount, asset and recipient checks; confirmation and expiry; retry-safe order updates; refund handling; maintenance; and total cost. Etherscan plus custom code or a self-hosted gateway may already do all of this. An optional agent example should buy a specific API response or merchant-defined product, not claim arbitrary stores are ready for autonomous ordering.

For hosted checkout, a simple internal decision model is:

`incremental contribution + avoided support/engineering cost - platform/network/integration costs`

Use the merchant's inputs. For example, the Professional plan's $49 monthly charge offsets the 0.5 percentage-point fee difference at $9,800/month of eligible volume, before other differences; this arithmetic does not establish that either plan is cheaper than the incumbent. Do not apply it to the unresolved x402 fee path.

## How to use the worklist

[targets.json](targets.json) is the source of truth. [targets.csv](targets.csv) is a generic account-research import with public contact routes, buyer roles, evidence, explicit hypotheses, exclusions, search queries and complete drafts. No existing outreach schema was found in this repository, so this is not claimed to match an external CRM's native format.

1. Import as **account research/drafts**, using `domain` as the company deduplication key and `id` as the stable record key. Do not map public role addresses into a guessed person's identity.
2. Carry `status=research_draft`, `send_approved=false` and blank `campaign_id` through the import. Source visibility is not opt-in. Merge [suppression.json](suppression.json) with the existing system's decline, unsubscribe, customer and active-opportunity checks.
3. Select a small initial cohort after reviewing the three leading niches. Verify the appropriate business contact, current source facts, merchant eligibility, commercial terms and the actual integration. Add the normal sender details and applicable opt-out footer in the sending system.
4. Use the niche search queries to find similar merchants, then collect the same evidence fields. A page mentioning crypto is not sufficient qualification. Stop on a decline; do not automatically schedule repeated follow-ups.
5. Track qualified replies, confirmed unsolved workflows, demos, successful paid fulfillment, reconciliation exceptions, onboarding hours, net cost and opt-outs. Treat early responses as discovery, not statistical proof of a niche's conversion rate.

Recreate or validate the CSV without network access:

```sh
python3 docs/outreach/2026-09-13-niches/export.py
python3 docs/outreach/2026-09-13-niches/export.py --check
```

The exporter validates unique accounts, exactly 10 niches, scoring, source/contact URLs, draft status and suppression exclusions. It does not access a CRM or send email.

## Scope and remaining decisions

This worklist covers lawful merchants and authorized services. Stripe's public restrictions demonstrate that legality and a processor's acceptance policy are separate questions, including rules that vary by country; they do not establish that a named prospect was rejected or that CoinPay may accept it. [Stripe restricted-business policy](https://stripe.com/legal/restricted-businesses).

Next decisions are the initial cohort and recipients, hosted-checkout webhook entitlement, x402 fee/settlement offer, and each pilot's SKU/resource and success metric. No campaign size, sending schedule, paid service or production-funds budget has been selected.

The upstream repository is public. Keep this commercially sensitive worklist and the suppression history local/internal unless publication is deliberately chosen. The private source email is not included.
