import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest, isMerchantAuth } from '@/lib/auth/middleware';
import { generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey, KeyObject } from 'crypto';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

function bytesToBase64url(bytes: Buffer | Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function base64urlToBytes(b64: string): Buffer {
  return Buffer.from(b64, 'base64url');
}

function base58btcEncode(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  const result: string[] = [];
  while (num > 0n) {
    const mod = Number(num % 58n);
    result.unshift(ALPHABET[mod]);
    num = num / 58n;
  }
  for (const b of bytes) {
    if (b === 0) result.unshift('1');
    else break;
  }
  return result.join('');
}

/**
 * Derive a did:key from an ed25519 public key (multicodec 0xed01)
 */
function publicKeyToDidKey(pubKeyRaw: Buffer): string {
  const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), pubKeyRaw]);
  return `did:key:z${base58btcEncode(multicodec)}`;
}

/**
 * POST /api/reputation/did/claim
 * Claim or link a DID for the authenticated merchant
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const authHeader = request.headers.get('authorization');
    const auth = await authenticateRequest(supabase, authHeader);

    if (!auth.success || !auth.context) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const merchantId = isMerchantAuth(auth.context)
      ? auth.context.merchantId
      : auth.context.merchantId;

    // Check if merchant already has a DID
    const { data: existing } = await supabase
      .from('merchant_dids')
      .select('*')
      .eq('merchant_id', merchantId)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: 'Merchant already has a DID. Each merchant can only have one DID.' },
        { status: 409 }
      );
    }

    let body: Record<string, string> | null = null;
    try {
      const text = await request.text();
      if (text.trim()) {
        body = JSON.parse(text);
      }
    } catch {
      // empty body = auto-generate
    }

    let did: string;
    let publicKey: string;
    let privateKeyEncrypted: string | null = null;

    if (body && body.did && body.public_key && body.signature) {
      // Link existing DID — verify signature proves ownership
      const pubKeyBytes = base64urlToBytes(body.public_key);
      const message = Buffer.from(`claim-did:${body.did}:${merchantId}`);
      const sigBytes = base64urlToBytes(body.signature);

      // Create KeyObject from raw public key bytes
      const pubKeyObj = createPublicKey({
        key: Buffer.concat([
          // Ed25519 public key DER prefix
          Buffer.from('302a300506032b6570032100', 'hex'),
          pubKeyBytes,
        ]),
        format: 'der',
        type: 'spki',
      });

      const valid = verify(null, message, pubKeyObj, sigBytes);
      if (!valid) {
        return NextResponse.json(
          { error: 'Invalid signature. Could not verify DID ownership.' },
          { status: 400 }
        );
      }

      did = body.did;
      publicKey = body.public_key;
    } else {
      // Auto-generate ed25519 keypair
      const { publicKey: pubKeyObj, privateKey: privKeyObj } = generateKeyPairSync('ed25519');

      // Extract raw key bytes
      const pubKeyRaw = pubKeyObj.export({ type: 'spki', format: 'der' }).subarray(-32);
      const privKeyRaw = privKeyObj.export({ type: 'pkcs8', format: 'der' }).subarray(-32);

      did = publicKeyToDidKey(pubKeyRaw);
      publicKey = bytesToBase64url(pubKeyRaw);
      privateKeyEncrypted = bytesToBase64url(privKeyRaw);
    }

    const { data, error } = await supabase
      .from('merchant_dids')
      .insert({
        merchant_id: merchantId,
        did,
        public_key: publicKey,
        private_key_encrypted: privateKeyEncrypted,
        verified: true,
      })
      .select()
      .single();

    if (error) {
      console.error('DID claim error:', error);
      return NextResponse.json({ error: 'Failed to store DID' }, { status: 500 });
    }

    return NextResponse.json({
      did: data.did,
      public_key: data.public_key,
      verified: data.verified,
      created_at: data.created_at,
    }, { status: 201 });
  } catch (error) {
    console.error('DID claim error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
