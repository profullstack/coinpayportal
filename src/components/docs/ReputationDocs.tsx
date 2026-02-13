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

      {/* Credential Endpoints */}
      <h3 className="text-2xl font-bold text-white mb-6 mt-10">Verifiable Credentials</h3>

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
    </DocSection>
  );
}
