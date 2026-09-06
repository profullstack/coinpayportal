/**
 * The bank transfer originator registry.
 *
 * One originator is active at a time, unlike the remittance registry where
 * several partners compete on price. There is nothing to rank here: a transfer
 * either goes out on the rail we are set up for or it does not go out.
 */

import { BankTransferProvider } from './types';
import { StubBankProvider } from './stub';

let registry: BankTransferProvider[] | null = null;

/** Every known originator, configured or not. */
export function getBankProviders(): BankTransferProvider[] {
  // Column's adapter is not registered yet: its wire format is unverified and
  // an unimplemented originator that reports itself configured would be worse
  // than one that is absent. See the note at the top of ./column.ts.
  registry ??= [new StubBankProvider()];
  return registry;
}

/**
 * The originator to use, or null when none is configured.
 *
 * Null is a normal answer and callers must handle it. Bank transfers are off
 * until an originator is onboarded, and a route that assumes one exists would
 * fail with a type error at the moment a user tried to move money.
 */
export function getActiveBankProvider(): BankTransferProvider | null {
  return getBankProviders().find((provider) => provider.isConfigured()) ?? null;
}

/** Whether money can move over a bank rail at all right now. */
export function bankTransfersEnabled(): boolean {
  return getActiveBankProvider() !== null;
}

/** Test seam. */
export function resetBankProviderRegistry(): void {
  registry = null;
}
