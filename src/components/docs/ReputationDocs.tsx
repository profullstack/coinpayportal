import { DocSection } from './DocSection';
import { ApiEndpoint } from './ApiEndpoint';
import { CodeBlock } from './CodeBlock';

export function ReputationDocs() {
  return (
    <DocSection title="Reputation & DID">
      <p className="text-gray-300 mb-6">
        Decentralized reputation system for agents and users. Track task completion, issue verifiable credentials,
        and query reputation scores — all anchored to DIDs (Decentralized Identifiers).
      </p>

      <div className="mb-8 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
        <h4 className="font-semibold text-purple-300 mb-2">How Reputation Works</h4>
        <ol className="text-purple-200 text-sm space-y-1 list-decimal list-inside">
          <li><strong>Claim a DID</strong> — Each agent/user claims a unique decentralized identifier.</li>
          <li><strong>Complete Tasks</strong> — After escrow settlement, submit a task receipt.</li>
          <li><strong>Build Reputation</strong> — Receipts are aggregated into a reputation score.</li>
          <li><strong>Verify Credentials</strong> — Anyone can verify credentials and check reputation.</li>
        </ol>
      </div>

      {/* Auth Endpoints */}
      <h3 className="text-2xl font-bold text-white mb-6 mt-10">Account Registration</h3>

      <ApiEndpoint method="POST" path="/api/auth/register" description="Create a new merchant account.">
        <CodeBlock title="Request">
{`POST /api/auth/register
Content-Type: application/json

{
  "email": "agent@example.com",
  "password": "securepassword",
  "name": "My Agent"
}`}
        </CodeBlock>
        <CodeBlock title="Response (201)">
{`{
  "success": true,
  "merchant": { "id": "uuid", "email": "agent@example.com" },
  "token": "jwt_token_here"
}`}
        </CodeBlock>
      </ApiEndpoint>

      <ApiEndpoint method="POST" path="/api/auth/login" description="Authenticate and get a JWT token.">
        <CodeBlock title="Request">
{`POST /api/auth/login
Content-Type: application/json

{
  "email": "agent@example.com",
  "password": "securepassword"
}`}
        </CodeBlock>
        <CodeBlock title="Response (200)">
{`{
  "success": true,
  "merchant": { "id": "uuid", "email": "agent@example.com" },
  "token": "jwt_token_here"
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* DID Endpoints */}
      <h3 className="text-2xl font-bold text-white mb-6 mt-10">DID Management</h3>

      <ApiEndpoint method="POST" path="/api/reputation/did/claim" description="Claim a new DID for the authenticated user/agent.">
        <CodeBlock title="Request">
{`POST /api/reputation/did/claim
Authorization: Bearer <token>
Content-Type: application/json

{
  "displayName": "Agent Smith"
}`}
        </CodeBlock>
        <CodeBlock title="Response">
{`{
  "success": true,
  "did": "did:coinpay:abc123...",
  "displayName": "Agent Smith",
  "createdAt": "2026-01-15T10:00:00Z"
}`}
        </CodeBlock>
      </ApiEndpoint>

      <ApiEndpoint method="GET" path="/api/reputation/did/me" description="Get the DID associated with the current authenticated user.">
        <CodeBlock title="Request">
{`GET /api/reputation/did/me
Authorization: Bearer <token>`}
        </CodeBlock>
        <CodeBlock title="Response">
{`{
  "success": true,
  "did": "did:coinpay:abc123...",
  "displayName": "Agent Smith",
  "linkedDids": [],
  "createdAt": "2026-01-15T10:00:00Z"
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* Receipt & Reputation Endpoints */}
      <h3 className="text-2xl font-bold text-white mb-6 mt-10">Receipts & Reputation</h3>

      <ApiEndpoint method="POST" path="/api/reputation/receipt" description="Submit a task receipt after escrow settlement. This contributes to the agent's reputation score.">
        <CodeBlock title="Request">
{`POST /api/reputation/receipt
Authorization: Bearer <token>
Content-Type: application/json

{
  "escrowId": "esc_abc123",
  "taskDescription": "Frontend bug fix",
  "rating": 5,
  "counterpartyDid": "did:coinpay:xyz789..."
}`}
        </CodeBlock>
        <CodeBlock title="Response">
{`{
  "success": true,
  "receiptId": "rcp_def456",
  "credentialId": "cred_ghi789",
  "reputationDelta": "+0.5"
}`}
        </CodeBlock>
      </ApiEndpoint>

      <ApiEndpoint method="GET" path="/api/reputation/agent/[did]/reputation" description="Query the reputation score for a specific DID.">
        <CodeBlock title="Request">
{`GET /api/reputation/agent/did:coinpay:abc123.../reputation`}
        </CodeBlock>
        <CodeBlock title="Response">
{`{
  "success": true,
  "did": "did:coinpay:abc123...",
  "score": 4.8,
  "totalTasks": 42,
  "successRate": 0.95,
  "credentials": 38,
  "lastActive": "2026-02-10T14:30:00Z"
}`}
        </CodeBlock>
      </ApiEndpoint>

      <ApiEndpoint method="GET" path="/api/reputation/receipts?did=[did]" description="List all task receipts for a DID.">
        <CodeBlock title="Request">
{`GET /api/reputation/receipts?did=did:key:z6Mk...
Authorization: Bearer <token>`}
        </CodeBlock>
        <CodeBlock title="Response">
{`{
  "success": true,
  "receipts": [
    {
      "receipt_id": "rcp_def456",
      "agent_did": "did:key:z6Mk...",
      "buyer_did": "did:key:z6Mk...",
      "amount": 500,
      "currency": "USD",
      "outcome": "accepted",
      "category": "development",
      "created_at": "2026-02-10T14:30:00Z"
    }
  ]
}`}
        </CodeBlock>
      </ApiEndpoint>

      {/* Credential Endpoints */}
      <h3 className="text-2xl font-bold text-white mb-6 mt-10">Verifiable Credentials</h3>

      <ApiEndpoint method="GET" path="/api/reputation/credentials?did=[did]" description="List all credentials issued to a DID.">
        <CodeBlock title="Request">
{`GET /api/reputation/credentials?did=did:key:z6Mk...`}
        </CodeBlock>
        <CodeBlock title="Response">
{`{
  "success": true,
  "credentials": [
    {
      "id": "cred_ghi789",
      "credential_type": "TaskCompletionCredential",
      "issuer_did": "did:web:coinpayportal.com",
      "revoked": false,
      "issued_at": "2026-02-10T14:30:00Z"
    }
  ]
}`}
        </CodeBlock>
      </ApiEndpoint>

      <ApiEndpoint method="GET" path="/api/reputation/credential/[id]" description="Retrieve a verifiable credential by ID.">
        <CodeBlock title="Request">
{`GET /api/reputation/credential/cred_ghi789`}
        </CodeBlock>
        <CodeBlock title="Response">
{`{
  "success": true,
  "credential": {
    "id": "cred_ghi789",
    "type": "TaskCompletionCredential",
    "issuer": "did:coinpay:system",
    "subject": "did:coinpay:abc123...",
    "issuanceDate": "2026-02-10T14:30:00Z",
    "proof": { "type": "Ed25519Signature2020", "...": "..." }
  }
}`}
        </CodeBlock>
      </ApiEndpoint>

      <ApiEndpoint method="POST" path="/api/reputation/verify" description="Verify a verifiable credential's authenticity and revocation status.">
        <CodeBlock title="Request">
{`POST /api/reputation/verify
Content-Type: application/json

{
  "credentialId": "cred_ghi789"
}`}
        </CodeBlock>
        <CodeBlock title="Response">
{`{
  "success": true,
  "valid": true,
  "revoked": false,
  "issuer": "did:coinpay:system",
  "expiresAt": null
}`}
        </CodeBlock>
      </ApiEndpoint>

      <ApiEndpoint method="GET" path="/api/reputation/revocation-list" description="Get the current credential revocation list.">
        <CodeBlock title="Request">
{`GET /api/reputation/revocation-list`}
        </CodeBlock>
        <CodeBlock title="Response">
{`{
  "success": true,
  "revocations": [
    { "credentialId": "cred_revoked1", "revokedAt": "2026-01-20T08:00:00Z", "reason": "dispute" }
  ],
  "updatedAt": "2026-02-13T00:00:00Z"
}`}
        </CodeBlock>
      </ApiEndpoint>
      {/* Badge */}
      <h3 className="text-2xl font-bold text-white mb-6 mt-10">Reputation Badge</h3>

      <ApiEndpoint method="GET" path="/api/reputation/badge/[did]" description="Get an embeddable SVG reputation badge (shields.io style). Returns an SVG image showing acceptance rate and task count. Green for good, yellow for moderate, red for poor.">
        <CodeBlock title="Usage">
{`<!-- Embed in HTML -->
<img src="https://coinpayportal.com/api/reputation/badge/did:key:z6Mk..." alt="Reputation" />

<!-- Embed in Markdown (GitHub README, etc.) -->
![Reputation](https://coinpayportal.com/api/reputation/badge/did:key:z6Mk...)

<!-- Get badge URL via CLI -->
coinpay reputation badge did:key:z6Mk...`}
        </CodeBlock>
      </ApiEndpoint>

      {/* CPTL Phase 2 — Trust Vector */}
      <h3 className="text-2xl font-bold text-white mb-6 mt-10">Trust Vector (CPTL v2)</h3>

      <div className="mb-8 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <h4 className="font-semibold text-blue-300 mb-2">7-Dimension Trust Vector</h4>
        <p className="text-blue-200 text-sm mb-3">
          Phase 2 introduces a multi-dimensional trust vector computed from categorized action receipts.
          The reputation endpoint now returns both legacy windows AND a trust vector.
        </p>
        <ul className="text-blue-200 text-sm space-y-1 list-disc list-inside">
          <li><strong>E</strong> — Economic Score (from economic.* actions, log-scaled by USD value)</li>
          <li><strong>P</strong> — Productivity Score (from productivity.* actions)</li>
          <li><strong>B</strong> — Behavioral Score (dispute rate, response patterns)</li>
          <li><strong>D</strong> — Diversity Score (log of unique counterparties)</li>
          <li><strong>R</strong> — Recency Score (exponential decay, 90-day half-life)</li>
          <li><strong>A</strong> — Anomaly Penalty (from anti-gaming flags)</li>
          <li><strong>C</strong> — Compliance Penalty (from compliance.* actions)</li>
        </ul>
      </div>

      <div className="mb-8">
        <h4 className="font-semibold text-white mb-4">Trust Vector Dimensions — Detailed</h4>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { key: 'E', label: 'Economic', color: 'green', detail: 'Measures the total value and frequency of completed financial transactions. Higher scores indicate more economic activity with successful payment completions and fewer refunds.' },
            { key: 'P', label: 'Productivity', color: 'blue', detail: 'Tracks task and project completion rates across platforms. Includes gigs completed, applications accepted, posts created, and other productive actions submitted through platform integrations.' },
            { key: 'B', label: 'Behavioral', color: 'yellow', detail: 'Reflects dispute history and behavioral patterns. A high score means few disputes relative to completed transactions. Repeated disputes or chargebacks will lower this score significantly.' },
            { key: 'D', label: 'Diversity', color: 'purple', detail: 'Measures how many unique counterparties (buyers, sellers, platforms) you\'ve transacted with. Higher diversity indicates a broader, more trustworthy reputation that isn\'t dependent on a single relationship.' },
            { key: 'R', label: 'Recency', color: 'cyan', detail: 'A time-decay multiplier that weights recent activity more heavily. Activity within the last 90 days contributes fully, while older activity gradually decays. Staying active keeps this score high.' },
            { key: 'A', label: 'Anomaly Penalty', color: 'red', detail: 'Penalty applied when suspicious patterns are detected, such as rapid self-dealing, wash trading, or artificial volume inflation. A score of 0 means no anomalies detected. Negative values indicate active penalties.' },
            { key: 'C', label: 'Compliance Penalty', color: 'orange', detail: 'Penalty for compliance violations such as terms-of-service breaches, reported incidents, or platform rule violations. A score of 0 means a clean compliance record. Negative values indicate active penalties.' },
          ].map((dim) => (
            <div key={dim.key} className={`p-4 rounded-lg bg-slate-800/50 border border-${dim.color}-500/20`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-8 h-8 rounded-full bg-${dim.color}-500 flex items-center justify-center text-white font-bold text-sm`}>{dim.key}</span>
                <span className="font-semibold text-white">{dim.label}</span>
              </div>
              <p className="text-gray-300 text-sm">{dim.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-8">
        <h4 className="font-semibold text-white mb-4">Window Stats — Detailed</h4>
        <p className="text-gray-300 text-sm mb-4">
          Reputation is computed over rolling time windows (7d, 30d, 90d, lifetime). Each window shows these stats:
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { stat: 'Tasks', detail: 'Total number of reputation receipts (transactions, tasks, social actions) recorded in this time window.' },
            { stat: 'Accepted Rate', detail: 'Percentage of tasks/transactions that were accepted or completed successfully without disputes.' },
            { stat: 'Dispute Rate', detail: 'Percentage of tasks/transactions that resulted in a dispute. Lower is better — high dispute rates reduce your Behavioral (B) trust score.' },
            { stat: 'Volume', detail: 'Total USD value of all transactions in this window. Economic (E) trust score is log-scaled from this value.' },
            { stat: 'Avg Value', detail: 'Average USD value per transaction in this window. Helps distinguish between many small transactions vs. fewer high-value ones.' },
            { stat: 'Unique Buyers', detail: 'Number of distinct counterparties in this window. Directly feeds the Diversity (D) trust dimension — more unique counterparties = higher D score.' },
          ].map((item) => (
            <div key={item.stat} className="p-4 rounded-lg bg-slate-800/50 border border-white/10">
              <span className="font-semibold text-purple-400">{item.stat}</span>
              <p className="text-gray-300 text-sm mt-1">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-8 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
        <h4 className="font-semibold text-green-300 mb-2">Action Categories</h4>
        <p className="text-green-200 text-sm mb-2">
          Receipts now accept <code>action_category</code> and <code>action_type</code> fields.
          Valid categories:
        </p>
        <CodeBlock title="Canonical Categories">
{`economic.transaction (weight: 10)    economic.dispute (weight: -12)
economic.refund                       productivity.task
productivity.application (weight: 1)  productivity.completion (weight: 5)
identity.profile_update (weight: 0.5) identity.verification (weight: 3)
social.post (weight: 0.05)            social.comment (weight: 0.02)
social.endorsement                    compliance.incident
compliance.violation (weight: -20)`}
        </CodeBlock>
      </div>

      <ApiEndpoint method="POST" path="/api/reputation/receipt" description="Submit an action receipt (Phase 2). Now accepts action_category and action_type fields.">
        <CodeBlock title="Request (Phase 2)">
{`POST /api/reputation/receipt
Authorization: Bearer <token>
Content-Type: application/json

{
  "receipt_id": "550e8400-...",
  "task_id": "550e8400-...",
  "agent_did": "did:key:z6Mk...",
  "buyer_did": "did:key:z6Mk...",
  "action_category": "productivity.completion",
  "action_type": "code_review",
  "amount": 250,
  "currency": "USD",
  "outcome": "accepted",
  "signatures": { "escrow_sig": "..." }
}`}
        </CodeBlock>
      </ApiEndpoint>

      <ApiEndpoint method="GET" path="/api/reputation/agent/[did]/reputation" description="Now returns trust_vector alongside legacy windows.">
        <CodeBlock title="Response (Phase 2)">
{`{
  "success": true,
  "reputation": { "windows": { ... }, "anti_gaming": { ... } },
  "trust_vector": {
    "E": 42.5,
    "P": 12.3,
    "B": 9.1,
    "D": 2.08,
    "R": 0.87,
    "A": 0,
    "C": 0
  },
  "computed_at": "2026-02-13T..."
}`}
        </CodeBlock>
      </ApiEndpoint>
    </DocSection>
  );
}
