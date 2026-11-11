/**
 * The remote MCP server as an OAuth 2.0 protected resource (RFC 9728).
 *
 * MCP clients read the metadata from the `resource_metadata` URL in the 401's
 * WWW-Authenticate header (the path-suffixed form) or from the root form.
 * `resource` must equal the server URL exactly or Claude refuses it.
 */
import { issuer } from '@/lib/oauth/metadata';

/** The OAuth scope the MCP server requires. Nothing else accepts it. */
export const MCP_SCOPE = 'invoices';

export const MCP_PATH = '/api/mcp';

export function mcpResourceUrl(): string {
  return `${issuer()}${MCP_PATH}`;
}

export function protectedResourceMetadataUrl(): string {
  return `${issuer()}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

export function protectedResourceMetadata(): Record<string, unknown> {
  const iss = issuer();
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [iss],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'CoinPay',
    resource_documentation: `${iss}/docs/mcp`,
  };
}

/** WWW-Authenticate for a 401/403 from /api/mcp (RFC 6750 + RFC 9728). */
export function mcpWwwAuthenticate(error?: 'invalid_token' | 'insufficient_scope', description?: string): string {
  const parts = [`resource_metadata="${protectedResourceMetadataUrl()}"`, `scope="${MCP_SCOPE}"`];
  if (error) parts.unshift(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/["\\]/g, '')}"`);
  return `Bearer ${parts.join(', ')}`;
}
