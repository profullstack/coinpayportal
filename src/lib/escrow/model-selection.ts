/**
 * Escrow model selection.
 *
 * Decides whether a new escrow is created as `multisig_2of3` (non-custodial —
 * CoinPay holds 1 of 3 keys) or `custodial` (CoinPay holds the funds outright).
 *
 * Two rules drive everything here:
 *
 *  1. **Prefer multisig when it can actually work.** Multisig is the default,
 *     but it only supports native coins, needs pubkeys, and cannot express
 *     recurring series or auto-release. Where it can't do the job we fall back
 *     to custodial rather than refusing to create an escrow at all.
 *
 *  2. **Never silently downgrade an explicit request.** If a caller explicitly
 *     asks for `multisig_2of3` and we cannot provide it, that is an error, not
 *     a quiet swap to custody. Silently handing someone a custodial escrow when
 *     they asked for a non-custodial one is precisely the kind of thing
 *     `/custody` exists to promise we don't do.
 *
 * The fallback in case 1 is a *default* being resolved, not a request being
 * overridden, and callers are told which model they got and why so the UI and
 * API can say so.
 */

import { multisigChainSchema } from '../multisig/validation';
import type { EscrowModel } from '../multisig/types';

/** Chains that support 2-of-3 multisig. Native coins only — no USDC/USDT. */
export const MULTISIG_SUPPORTED_CHAINS: readonly string[] = multisigChainSchema.options;

export function isMultisigSupportedChain(chain: string): boolean {
  return MULTISIG_SUPPORTED_CHAINS.includes(chain);
}

/** Why the resolved model was chosen — surfaced to the UI and API responses. */
export type EscrowModelReason =
  | 'explicit' // caller named the model
  | 'multisig-default' // default applied, multisig viable
  | 'multisig-disabled' // default wanted multisig, feature flag is off
  | 'multisig-not-default' // multisig available but not the configured default
  | 'chain-unsupported' // default wanted multisig, chain has no multisig support
  | 'recurring-unsupported'; // default wanted multisig, but this is a recurring series

export interface SelectEscrowModelInput {
  /** Model named by the caller, if any. Absent means "apply the default". */
  requested?: EscrowModel | null;
  /** Chain/coin the escrow settles in. */
  chain: string;
  /** Whether this escrow is part of a recurring series. */
  recurring?: boolean;
  /** `MULTISIG_ESCROW_ENABLED` — multisig is operable at all. */
  multisigEnabled: boolean;
  /** `MULTISIG_DEFAULT` — multisig is preferred when no model is named. */
  multisigDefault: boolean;
}

export type SelectEscrowModelResult =
  | { ok: true; model: EscrowModel; reason: EscrowModelReason }
  | { ok: false; error: string };

/**
 * Resolve which escrow model to create.
 *
 * Returns `ok: false` only when an explicit `multisig_2of3` request cannot be
 * honoured. An unspecified model always resolves to something creatable.
 */
/**
 * ESC-NEW-05: this function has no callers, and did not have any when the audit
 * was written — the model decision is made by the two creation endpoints
 * instead (`/api/escrow` is custodial-only; `/api/escrow/multisig` needs the
 * three pubkeys, which a single resolver cannot conjure).
 *
 * It is kept, with its tests, because it is the clearest statement of the
 * intended rules and is the right shape if the endpoints are ever merged. This
 * note exists so nobody reads it as the thing that governs custody today: it
 * does not. `MULTISIG_DEFAULT` is honoured by the browser's create page, and
 * `/api/escrow` now tells an API caller when it has defaulted them to custodial
 * on a deployment that advertises otherwise.
 */
export function selectEscrowModel(input: SelectEscrowModelInput): SelectEscrowModelResult {
  const { requested, chain, recurring = false, multisigEnabled, multisigDefault } = input;

  // ── Explicit request: honour it, or fail loudly ──────────────
  if (requested === 'multisig_2of3') {
    if (!multisigEnabled) {
      return {
        ok: false,
        error:
          'Multisig escrow is not enabled. It is not available on this deployment — ' +
          'create a custodial escrow explicitly if CoinPay holding the funds is acceptable.',
      };
    }
    if (!isMultisigSupportedChain(chain)) {
      return {
        ok: false,
        error:
          `Multisig escrow does not support ${chain}. Supported chains: ` +
          `${MULTISIG_SUPPORTED_CHAINS.join(', ')}. Stablecoins such as USDC and USDT ` +
          'are not supported by the multisig model.',
      };
    }
    if (recurring) {
      return {
        ok: false,
        error:
          'Multisig escrow cannot be used for recurring escrow series. Create the series ' +
          'as custodial, or create individual multisig escrows per period.',
      };
    }
    return { ok: true, model: 'multisig_2of3', reason: 'explicit' };
  }

  if (requested === 'custodial') {
    return { ok: true, model: 'custodial', reason: 'explicit' };
  }

  // ── No explicit request: apply the default ───────────────────
  if (!multisigEnabled) {
    return { ok: true, model: 'custodial', reason: 'multisig-disabled' };
  }
  if (!multisigDefault) {
    return { ok: true, model: 'custodial', reason: 'multisig-not-default' };
  }
  if (!isMultisigSupportedChain(chain)) {
    return { ok: true, model: 'custodial', reason: 'chain-unsupported' };
  }
  if (recurring) {
    return { ok: true, model: 'custodial', reason: 'recurring-unsupported' };
  }
  return { ok: true, model: 'multisig_2of3', reason: 'multisig-default' };
}

/**
 * Plain-language explanation of a resolved model, for UI and API responses.
 * Custodial outcomes always say that CoinPay holds the funds — a fallback the
 * user did not ask for must not be quiet about what it means.
 */
export function explainEscrowModel(model: EscrowModel, reason: EscrowModelReason): string {
  if (model === 'multisig_2of3') {
    return 'Funds are locked on-chain and need 2 of 3 signatures to move. CoinPay holds one key and cannot move funds alone.';
  }

  const custodyWarning = 'CoinPay holds these funds for the length of the escrow.';

  switch (reason) {
    case 'explicit':
      return `Custodial escrow. ${custodyWarning}`;
    case 'multisig-disabled':
      return `Custodial escrow — multisig is not enabled on this deployment. ${custodyWarning}`;
    case 'multisig-not-default':
      return `Custodial escrow. ${custodyWarning} Multisig is available if you request it.`;
    case 'chain-unsupported':
      return `Custodial escrow — multisig does not support this coin (stablecoins are not supported). ${custodyWarning}`;
    case 'recurring-unsupported':
      return `Custodial escrow — multisig cannot be used for recurring series. ${custodyWarning}`;
    default:
      return `Custodial escrow. ${custodyWarning}`;
  }
}
