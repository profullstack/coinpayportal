/**
 * Web Bot Auth — RFC 8941 structured field parsing
 *
 * Only the shapes RFC 9421 actually puts on the wire are handled here:
 * a Dictionary of Inner Lists with parameters (`Signature-Input`) and a
 * Dictionary of Byte Sequences (`Signature`). This is deliberately not a
 * general structured-fields implementation.
 *
 * The important detail is `raw`: for each dictionary member we keep the exact
 * source text of its value. The signature base has to reproduce the signer's
 * `@signature-params` byte for byte, and re-serializing a parsed value is a
 * good way to differ from the signer over whitespace or parameter order and
 * fail every signature for reasons that look like a crypto bug.
 */

export interface SignatureInputEntry {
  /** Covered component identifiers, in signing order, unquoted. */
  components: string[];
  /** Signature parameters: created, expires, keyid, alg, nonce, tag. */
  params: Record<string, string | number | boolean>;
  /** Verbatim source text of this member's value, for the signature base. */
  raw: string;
}

/**
 * Split a structured-field Dictionary into `label -> raw value` pairs.
 *
 * Splitting happens only at top-level commas — those inside quoted strings,
 * byte sequences or inner lists belong to the member, not between members.
 */
function splitDictionary(value: string): Array<{ label: string; raw: string }> {
  const members: Array<{ label: string; raw: string }> = [];

  let depth = 0;
  let inString = false;
  let inBytes = false;
  let escaped = false;
  let start = 0;

  const push = (end: number) => {
    const chunk = value.slice(start, end).trim();
    if (!chunk) return;
    const eq = chunk.indexOf('=');
    // A dictionary member with no "=" is a boolean true; it carries no
    // signature data, so record it with an empty value rather than dropping
    // the label.
    if (eq === -1) {
      members.push({ label: chunk.trim(), raw: '' });
      return;
    }
    members.push({ label: chunk.slice(0, eq).trim(), raw: chunk.slice(eq + 1).trim() });
  };

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (inBytes) {
      if (ch === ':') inBytes = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === ':') inBytes = true;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(value.length);

  return members;
}

/**
 * Parse the parameter tail that follows a value, e.g. `;created=1;tag="x"`.
 */
function parseParams(text: string): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {};

  let i = 0;
  while (i < text.length) {
    if (text[i] !== ';') {
      i++;
      continue;
    }
    i++; // consume ';'
    while (text[i] === ' ') i++;

    // Parameter name
    let name = '';
    while (i < text.length && /[a-zA-Z0-9_\-.*]/.test(text[i])) {
      name += text[i];
      i++;
    }
    if (!name) continue;

    // Bare parameter -> boolean true
    if (text[i] !== '=') {
      params[name] = true;
      continue;
    }
    i++; // consume '='

    if (text[i] === '"') {
      i++;
      let out = '';
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++;
        out += text[i];
        i++;
      }
      i++; // closing quote
      params[name] = out;
      continue;
    }

    let token = '';
    while (i < text.length && text[i] !== ';') {
      token += text[i];
      i++;
    }
    token = token.trim();
    // Integers and decimals arrive as numbers; anything else stays a token.
    params[name] = /^-?\d+(\.\d+)?$/.test(token) ? Number(token) : token;
  }

  return params;
}

/**
 * Parse a `Signature-Input` header value.
 *
 * @example
 *   sig1=("@authority" "signature-agent");created=1735689600;keyid="abc";alg="ed25519";tag="web-bot-auth"
 */
export function parseSignatureInput(value: string): Map<string, SignatureInputEntry> {
  const out = new Map<string, SignatureInputEntry>();
  if (!value) return out;

  for (const { label, raw } of splitDictionary(value)) {
    const open = raw.indexOf('(');
    const close = raw.indexOf(')');
    // Signature-Input members are always inner lists. Anything else is not a
    // signature description and is skipped rather than half-parsed.
    if (open === -1 || close === -1 || close < open) continue;

    const inner = raw.slice(open + 1, close);
    const components: string[] = [];
    const itemPattern = /"((?:[^"\\]|\\.)*)"(?:;[^\s)]*)?/g;
    let m: RegExpExecArray | null;
    while ((m = itemPattern.exec(inner)) !== null) {
      components.push(m[1]);
    }

    out.set(label, {
      components,
      params: parseParams(raw.slice(close + 1)),
      raw,
    });
  }

  return out;
}

/**
 * Parse a `Signature` header value into raw signature bytes per label.
 *
 * Values are Byte Sequences: base64 delimited by colons, e.g. `sig1=:AAAA:`.
 */
export function parseSignatureHeader(value: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  if (!value) return out;

  for (const { label, raw } of splitDictionary(value)) {
    const first = raw.indexOf(':');
    const last = raw.lastIndexOf(':');
    if (first === -1 || last <= first) continue;

    const b64 = raw.slice(first + 1, last);
    try {
      out.set(label, Buffer.from(b64, 'base64'));
    } catch {
      // A member whose bytes will not decode cannot verify; leave it out.
    }
  }

  return out;
}
