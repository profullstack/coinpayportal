/**
 * The on-ramp source registry.
 *
 * Order here is not priority — the router ranks on delivered amount, so a
 * source listed first has no advantage. It only decides the order sources are
 * reported in when unavailable.
 */

import { OnrampProvider } from './types';
import { OnramperProvider } from './onramper';
import { TransakProvider } from './transak';
import { StubOnrampProvider } from './stub';

let registry: OnrampProvider[] | null = null;

/**
 * Every known source, configured or not.
 *
 * Instances are cached, but each reads its credential from the environment on
 * demand rather than at construction — otherwise a key set after first import
 * would never be picked up.
 */
export function getOnrampProviders(): OnrampProvider[] {
  registry ??= [new OnramperProvider(), new TransakProvider(), new StubOnrampProvider()];
  return registry;
}

/** Sources with credentials present. */
export function getConfiguredProviders(): OnrampProvider[] {
  return getOnrampProviders().filter((provider) => provider.isConfigured());
}

/** True when at least one source can be quoted. */
export function isOnrampAvailable(): boolean {
  return getConfiguredProviders().length > 0;
}

/** Look up one source by id, for pinning an order to the quote's winner. */
export function getProviderById(id: string): OnrampProvider | undefined {
  return getOnrampProviders().find((provider) => provider.id === id);
}

/** Test seam. */
export function resetProviderRegistry(): void {
  registry = null;
}
