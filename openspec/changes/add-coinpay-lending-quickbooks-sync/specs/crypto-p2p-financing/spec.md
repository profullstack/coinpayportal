# crypto-p2p-financing specification

Source: `prd/0001-coinpay-lending-quickbooks-sync.md`. These proposed deltas preserve the PRD policy and add acceptance scenarios. They do not claim implemented behavior or live availability. Update the PRD, deltas and traceability together when requirements change.

## ADDED Requirements

### Requirement: R33 — Add stablecoin settlement without an inventory requirement

The system SHALL enforce the following policy from PRD 0001 R33 [P1]:

Model funding asset, denomination, remittance asset, settlement route, and destination as separate fields. Initial production scope is one approved native stablecoin on one provider-supported chain. An external funder/provider sends funds directly to the authorized merchant destination or through an appropriately approved third-party settlement arrangement. No CoinPay treasury-funded swaps or bridge loans. Fiat-to-crypto conversion is a separately accepted provider quote, not an automatic assumption that the financing partner supports crypto.

#### Scenario: One approved external stablecoin route

- **GIVEN** a verified program supports one approved native stablecoin/chain and an authorized merchant destination
- **WHEN** stablecoin funding is prepared
- **THEN** funding denomination, asset, remittance asset and rail remain explicit; external capital supplies the transfer or approved conversion with a separately accepted quote and no CoinPay treasury inventory

### Requirement: R34 — Verify every enabled crypto rail

The system SHALL enforce the following policy from PRD 0001 R34 [P0]:

Require asset/contract allowlists, correct chain and decimals, wallet-control proof, screened counterparties, signed intent/nonce/expiry, amount and fee limits, replay protection, chain-specific finality, reorg handling, supported refund procedures, and a depeg/freeze/outage policy. Revalidate quotes and destinations before execution. A wallet signature proves control, not legal identity or repayment ability. Testnet success is not production approval.

#### Scenario: A13 — Reorg before required finality

- **GIVEN** a funding transaction was observed but has not reached the approved chain's required finality
- **WHEN** the transaction is reorged out of the chain
- **THEN** funding is not active/final; chain state is reconciled and dependent disbursements are prevented while nonce, destination, asset, limits and expiry protections remain enforced

### Requirement: R35 — Do not assume existing wallets/escrow are suitable custody boundaries

The system SHALL enforce the following policy from PRD 0001 R35 [P0]:

Inspect forwarding keys, recovery authority, contract administrator powers, upgradeability, pause rights, and actual value flow before reusing a CoinPay payment primitive. CoinPay SHALL NOT pool lender capital or possess unrestricted spending authority over borrower wallets. Use bounded explicit mandates where lawful and supported, or merchant-signed payments. “Non-custodial” is a description requiring evidence, not a legal exemption.

#### Scenario: Unrestricted wallet authority blocks reuse

- **GIVEN** an existing wallet or escrow primitive exposes forwarding/recovery/admin powers allowing unrestricted spending or pooling
- **WHEN** the proposed financing rail is reviewed
- **THEN** the primitive cannot be reused as a verified custody boundary; actual control must be reviewed and only lawful bounded mandates or merchant-signed payments may proceed

### Requirement: R36 — Start P2P with a legally reviewed external-funder workflow

The system SHALL enforce the following policy from PRD 0001 R36 [P2]:

A qualified external lender or capital provider may fund one approved deal through a compliant origination/servicing structure. The funder must satisfy the requirements of that structure, including any applicable investor verification; a website checkbox declaring “accredited” is not a universal solution. No public deal solicitation or funding commitment is enabled until offering/intermediary/credit-law review is complete. P2P does not require a transferable token.

#### Scenario: Single-funder legal structure precedes solicitation

- **GIVEN** a prospective funder only checked an accredited box and there is no reviewed offering/origination/servicing structure
- **WHEN** the funder tries to view a public deal or commit funding
- **THEN** solicitation and commitment remain unavailable until the actual structure and participant eligibility are verified; no transferable token is required

### Requirement: R37 — Add multi-funder allocation only after the single-funder route works

The system SHALL enforce the following policy from PRD 0001 R37 [P2]:

Support per-deal commitments, allocations, funding deadlines, actual funding receipts, minimum funding conditions, and fair rounding. Unfunded commitments SHALL NOT count as cash. Underfunded deals expire/cancel according to their documents; unused funds are returned by the approved escrow/settlement operator. CoinPay never holds the pool. Smart-contract deployment requires separate legal/control review and an independent security audit before production.

#### Scenario: A15 — Commitments exceed actual receipts

- **GIVEN** a multi-funder deal has $10,000 in commitments but only $8,000 arrived by its funding deadline
- **WHEN** the minimum-funding condition is evaluated
- **THEN** the deal is not treated as funded at $10,000; documented underfunding/cancellation rules apply and the approved operator returns unused funds without CoinPay holding the pool

### Requirement: R38 — Distribute only realized collections

The system SHALL enforce the following policy from PRD 0001 R38 [P2]:

Investor/funder reporting SHALL distinguish committed capital, deployed capital, principal returned, realized financing income, fees, unresolved arrears, losses, and illiquid remaining exposure. Allocation of a remittance follows the signed waterfall and exact ownership shares. No new borrower/funder deposit may be used to fake a prior investor's return. No guaranteed yield or on-demand redemption for an illiquid financing position.

#### Scenario: A14 — Distribute a realized collection once

- **GIVEN** three verified funders own 50%, 30% and 20% of a deal and $50 is actually distributable under its signed waterfall
- **WHEN** the distribution is calculated and retried
- **THEN** allocations are $25, $15 and $10 before separately contracted fees, with one durable distribution event; reports distinguish realized amounts, remaining exposure, arrears and losses

### Requirement: R39 — Acknowledge off-chain enforcement and data trust

The system SHALL enforce the following policy from PRD 0001 R39 [P0]:

Revenue-based business financing requires business identity, enforceable agreements, trustworthy revenue evidence, and a servicing/default process. An on-chain contract cannot independently discover all a merchant's sales or compel repayment from an arbitrary wallet or external bank. Any signed revenue attestation SHALL identify the attestor, evidence version, rules, timestamp, challenge process, and authorized update rights. Do not market the proposed system as fully trustless.

#### Scenario: A revenue attestation discloses its trust basis

- **GIVEN** a provider uses a signed attestation based on consented off-chain sales evidence
- **WHEN** a borrower or permitted funder inspects the attestation
- **THEN** it identifies attestor, evidence version, rule, timestamp, challenge path and authorized update rights; no claim suggests a contract discovers all bank sales or compels repayment from arbitrary wallets

### Requirement: R40 — Keep sensitive information off-chain

The system SHALL enforce the following policy from PRD 0001 R40 [P0]:

Bank rows, customer identities, documents, tax IDs, credit information, contracts, and raw underwriting inputs SHALL remain encrypted off-chain with purpose-limited access. Public addresses and amounts can reveal commercial information; obtain appropriate consent. Any commitment hash must be designed against guessing attacks on predictable sensitive data. A funder receives only the data authorized for its actual role and deal.

#### Scenario: Sensitive data never enters a public transaction

- **GIVEN** a financing workflow contains bank rows, identity documents, contracts and underwriting data
- **WHEN** an on-chain operation or funder disclosure is prepared
- **THEN** sensitive records remain encrypted off-chain with purpose-limited access, public commercial disclosures require appropriate consent, and predictable sensitive values are not exposed through guessable commitment hashes

