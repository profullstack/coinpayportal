/**
 * GET /api/escrow/model-availability
 *
 * Tells clients which escrow models this deployment can actually create, so the
 * UI can offer multisig only when it works. Without this the create form would
 * happily offer "2-of-3 Multisig" on a deployment where MULTISIG_ESCROW_ENABLED
 * is unset, and the submit would fail with a 503.
 *
 * The server env vars are the single source of truth — deliberately not mirrored
 * into a NEXT_PUBLIC_* variable, which would be a second copy free to drift out
 * of sync with the flag the API actually enforces.
 *
 * Public and unauthenticated: it exposes feature-flag state and a chain list,
 * nothing user- or key-specific.
 */

import { NextResponse } from 'next/server';
import { isMultisigEnabled, isMultisigDefault } from '@/lib/multisig';
import { MULTISIG_SUPPORTED_CHAINS } from '@/lib/escrow/model-selection';

export const dynamic = 'force-dynamic';

export async function GET() {
  const multisigEnabled = isMultisigEnabled();

  return NextResponse.json({
    multisig_enabled: multisigEnabled,
    // Only meaningful when multisig is enabled; false otherwise so clients can
    // use it directly to pick a default without re-deriving the precedence.
    multisig_default: multisigEnabled && isMultisigDefault(),
    multisig_chains: MULTISIG_SUPPORTED_CHAINS,
  });
}
