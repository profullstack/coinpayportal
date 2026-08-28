/**
 * The remittance partner registry.
 *
 * Order is not priority — the router ranks on the local currency delivered, so
 * being listed first buys a partner nothing. It only sets the order partners
 * are reported in when unavailable.
 */

import { Corridor, RemittanceProvider, servesCorridor } from './types';
import { BitsoProvider } from './bitso';
import { TransfiProvider } from './transfi';
import { YellowCardProvider } from './yellowcard';
import { StubRemittanceProvider } from './stub';

let registry: RemittanceProvider[] | null = null;

/**
 * Every known partner, configured or not.
 *
 * Instances are cached, but each reads its credentials from the environment on
 * demand rather than at construction, so a key set after first import is still
 * picked up.
 */
export function getRemittanceProviders(): RemittanceProvider[] {
  registry ??= [
    new BitsoProvider(),
    new TransfiProvider(),
    new YellowCardProvider(),
    new StubRemittanceProvider(),
  ];
  return registry;
}

/** Partners that serve a corridor and have whatever credentials they need. */
export function getProvidersForCorridor(corridor: Corridor): RemittanceProvider[] {
  return getRemittanceProviders().filter(
    (provider) => servesCorridor(provider, corridor) && provider.isConfigured()
  );
}

/** True when a corridor can be quoted at all. */
export function isCorridorAvailable(corridor: Corridor): boolean {
  return getProvidersForCorridor(corridor).length > 0;
}

export function getProviderById(id: string): RemittanceProvider | undefined {
  return getRemittanceProviders().find((provider) => provider.id === id);
}

/** Test seam. */
export function resetProviderRegistry(): void {
  registry = null;
}
