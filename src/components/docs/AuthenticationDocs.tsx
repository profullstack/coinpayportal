import { DocSection } from './DocSection';
import { ApiEndpoint } from './ApiEndpoint';
import { CodeBlock } from './CodeBlock';

export function AuthenticationDocs() {
  return (
    <DocSection title="Authentication">
      <p className="text-gray-300 mb-6">
        All API requests require authentication using a JWT token in the Authorization header.
      </p>

      <ApiEndpoint method="POST" path="/api/auth/register" description="Create a new merchant account.">
        <CodeBlock title="Request Body">
{`{
  "email": "merchant@example.com",
  "password": "SecurePassword123!",
  "name": "My Business"  // optional
}`}
        </CodeBlock>

        <CodeBlock title="cURL Example" language="curl">
{`curl -X POST https://coinpayportal.com/api/auth/register \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "merchant@example.com",
    "password": "SecurePassword123!",
    "name": "My Business"
  }'`}
        </CodeBlock>

        <CodeBlock title="Node.js Example" language="javascript">
{`const response = await fetch('https://coinpayportal.com/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'merchant@example.com',
    password: 'SecurePassword123!',
    name: 'My Business'
  })
});
const data = await response.json();
console.log(data.token); // Save this token`}
        </CodeBlock>
      </ApiEndpoint>

      <ApiEndpoint method="POST" path="/api/auth/login" description="Login to get an authentication token.">
        <CodeBlock title="Request Body">
{`{
  "email": "merchant@example.com",
  "password": "SecurePassword123!"
}`}
        </CodeBlock>

        <CodeBlock title="Response">
{`{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "merchant": {
    "id": "merchant-123",
    "email": "merchant@example.com",
    "name": "My Business"
  }
}`}
        </CodeBlock>
      </ApiEndpoint>

      <ApiEndpoint method="GET" path="/api/auth/me" description="Get current authenticated merchant information.">
        <CodeBlock title="cURL Example" language="curl">
{`curl https://coinpayportal.com/api/auth/me \\
  -H "Authorization: Bearer YOUR_TOKEN"`}
        </CodeBlock>

        <CodeBlock title="Response">
{`{
  "success": true,
  "merchant": {
    "id": "merchant-123",
    "email": "merchant@example.com",
    "name": "My Business",
    "created_at": "2024-01-01T12:00:00Z"
  }
}`}
        </CodeBlock>
      </ApiEndpoint>
    </DocSection>
  );
}