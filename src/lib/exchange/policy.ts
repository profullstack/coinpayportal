/**
 * Policy gate. Every quote and order passes through here first, and every
 * decision is returned with the policy version so it can be recorded.
 *
 * Fail closed:
 * - The engine is off unless EXCHANGE_ENGINE_ENABLED=true.
 * - Fiat rails are off until a jurisdiction is explicitly approved in
 *   EXCHANGE_FIAT_APPROVED_JURISDICTIONS (written legal + provider + banking
 *   approval first; see docs/exchange-engine.md). No fiat adapter exists yet.
 * - Requests from comprehensively sanctioned countries are refused.
 *
 * Kill switches (comma-separated env, no deploy of code needed, only a restart):
 *   EXCHANGE_DISABLED_PROVIDERS=thorchain,changenow
 *   EXCHANGE_DISABLED_ASSETS=DOGE,USDT_SOL
 *   EXCHANGE_BLOCKED_COUNTRIES (replaces the default list when set)
 */

import type { ExchangeAsset, ExchangeProviderId, ExchangeRail } from './types';

export const POLICY_VERSION = '2026-11-22.1';

/** OFAC comprehensive-sanctions jurisdictions (country level). */
const DEFAULT_BLOCKED_COUNTRIES = ['CU', 'IR', 'KP', 'SY'];

function envList(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export function isExchangeEnabled(): boolean {
  return process.env.EXCHANGE_ENGINE_ENABLED === 'true';
}

export interface PolicyInput {
  rail: ExchangeRail;
  from: ExchangeAsset;
  to: ExchangeAsset;
  country?: string | null;
  provider?: ExchangeProviderId;
}

export type PolicyDecision =
  | { allow: true; version: string; reason: 'ok' }
  | { allow: false; version: string; reason: string };

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const deny = (reason: string): PolicyDecision => ({ allow: false, version: POLICY_VERSION, reason });

  if (!isExchangeEnabled()) return deny('engine_disabled');

  const country = input.country?.trim().toUpperCase() || null;
  const blocked = process.env.EXCHANGE_BLOCKED_COUNTRIES !== undefined
    ? envList('EXCHANGE_BLOCKED_COUNTRIES')
    : DEFAULT_BLOCKED_COUNTRIES;
  if (country && blocked.includes(country)) return deny('jurisdiction_blocked');

  if (input.rail !== 'crypto_crypto') {
    // Unknown jurisdiction is a denial for fiat, never a pass.
    if (!country) return deny('jurisdiction_unknown');
    if (!envList('EXCHANGE_FIAT_APPROVED_JURISDICTIONS').includes(country)) {
      return deny('fiat_jurisdiction_not_approved');
    }
    return deny('fiat_provider_not_integrated');
  }

  const disabledAssets = envList('EXCHANGE_DISABLED_ASSETS');
  if (disabledAssets.includes(input.from) || disabledAssets.includes(input.to)) {
    return deny('asset_disabled');
  }

  if (input.provider && envList('EXCHANGE_DISABLED_PROVIDERS').includes(input.provider.toUpperCase())) {
    return deny('provider_disabled');
  }

  return { allow: true, version: POLICY_VERSION, reason: 'ok' };
}

export function isProviderEnabled(provider: ExchangeProviderId): boolean {
  return !envList('EXCHANGE_DISABLED_PROVIDERS').includes(provider.toUpperCase());
}
