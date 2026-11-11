import type { Metadata } from 'next';
import Link from 'next/link';
import { DocSection } from '@/components/docs/DocSection';
import { CodeBlock } from '@/components/docs/CodeBlock';
import { listTools } from '@/lib/mcp/server';

export const metadata: Metadata = {
  title: 'CoinPay MCP server (remote, OAuth) | CoinPay Docs',
  description:
    'Connect Claude to your CoinPay invoices, projects, contractors, pay runs and document status with the remote MCP server at https://coinpayportal.com/api/mcp.',
};

export default function McpDocs() {
  const tools = listTools();
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link href="/docs" className="inline-flex items-center text-purple-400 hover:text-purple-300 mb-6">
          ← Back to API docs
        </Link>
        <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">CoinPay MCP server</h1>
        <p className="text-xl text-gray-300 mb-10">
          Ask Claude about your invoices, projects and contractors. The remote MCP server at{' '}
          <code>https://coinpayportal.com/api/mcp</code> signs you in with your CoinPay account (OAuth 2.1) and acts
          only for you.
        </p>

        <DocSection title="Connect">
          <p className="text-gray-300 mb-4">
            In Claude, add a custom connector with the URL below and sign in to CoinPay when asked. Claude registers
            itself (dynamic client registration) and you approve the <strong>Invoices and projects</strong> permission
            on the CoinPay consent screen.
          </p>
          <CodeBlock title="Server URL" language="http">{`https://coinpayportal.com/api/mcp`}</CodeBlock>
          <CodeBlock title="Claude Code" language="bash">{`claude mcp add --transport http coinpay https://coinpayportal.com/api/mcp`}</CodeBlock>
        </DocSection>

        <DocSection title="What it can and cannot do">
          <p className="text-gray-300 mb-4">
            It reads invoices, accounts-receivable aging, projects, contractors, contractor work, pay runs and e-sign
            document status, and it can create three kinds of record: a <strong>draft</strong> invoice, a time entry, and
            a <strong>draft</strong> invoice from a project&apos;s unbilled time. It never sends an invoice or an email,
            approves contractor work, drafts or pays a pay run, voids a document, or moves funds. Documents are end-to-end
            encrypted, so only their metadata and audit trail are visible. Finances, bank statements and tax documents
            are not on the remote server; they stay in the local <code>coinpay mcp</code> (stdio) server, which runs
            with your own <code>coinpay login</code>.
          </p>
          <p className="text-gray-300">
            Tools act with your role on each business, exactly as the dashboard does. Tools that take{' '}
            <code>businessId</code> fill it in when you have one business. Calls are limited to 60 a minute per user.
            Revoke access any time by revoking the app&apos;s token or removing the connector.
          </p>
        </DocSection>

        <DocSection title="Tools">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-300">
              <thead>
                <tr className="text-white">
                  <th className="py-2 pr-4">Tool</th>
                  <th className="py-2 pr-4">Kind</th>
                  <th className="py-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t) => (
                  <tr key={t.name} className="border-t border-white/10 align-top">
                    <td className="py-2 pr-4">
                      <code>{t.name}</code>
                      <div className="text-gray-400">{t.title}</div>
                    </td>
                    <td className="py-2 pr-4">{t.annotations.readOnlyHint ? 'read' : 'creates a record'}</td>
                    <td className="py-2">{t.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DocSection>

        <DocSection title="For client developers">
          <p className="text-gray-300 mb-4">
            Streamable HTTP, stateless, JSON responses (no SSE). An unauthenticated request gets{' '}
            <code>401</code> with{' '}
            <code>WWW-Authenticate: Bearer resource_metadata=&quot;https://coinpayportal.com/.well-known/oauth-protected-resource/api/mcp&quot;</code>
            . The authorization server is CoinPay itself (<Link href="/docs/oauth" className="text-purple-300 underline">Sign in with CoinPay</Link>
            ): authorization code + PKCE S256, scope <code>invoices</code>.
          </p>
          <CodeBlock title="Dynamic client registration (RFC 7591)" language="bash">
{`curl -X POST https://coinpayportal.com/api/oauth/register \\
  -H "Content-Type: application/json" \\
  -d '{"client_name":"My MCP client","redirect_uris":["http://127.0.0.1:33418/callback"]}'
# → 201 {client_id, token_endpoint_auth_method:"none", scope:"openid profile email invoices", ...}`}
          </CodeBlock>
          <p className="text-gray-400 text-sm">
            Open registration creates public clients only, for the Claude and ChatGPT connector callbacks or an http
            loopback redirect (<code>localhost</code>, <code>127.0.0.1</code>, <code>[::1]</code>, any port). Register
            any other app from the dashboard.
          </p>
        </DocSection>
      </div>
    </div>
  );
}
