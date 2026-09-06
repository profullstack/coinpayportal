/**
 * An in-memory bank transfer originator, for development and tests.
 *
 * Real enough to build the rest of the system against: it validates the same
 * way, holds state, and can be driven through settlement and return. It moves
 * no money and is never enabled in production — {@link StubBankProvider} reads
 * the same guard the remittance stub does, so a missing key can never silently
 * fall back to synthetic transfers on a live deployment.
 *
 * The reason it can advance a transfer to `returned` matters more than it
 * looks. A return is the one path most bank integrations never exercise before
 * launch, because it is tedious to trigger with a real bank, and it is also the
 * path that loses money. Making it a one-line call here means the handling code
 * is tested from the start rather than the first time a customer's debit
 * bounces.
 */

import {
  BankTransfer,
  BankTransferProvider,
  BankTransferRequest,
  TransferStatus,
  validateTransferRequest,
} from './types';

export class StubBankProvider implements BankTransferProvider {
  readonly id = 'stub';
  readonly label = 'Stub (no money moves)';
  readonly currencies = ['USD'] as const;

  private transfers = new Map<string, BankTransfer>();
  /** Idempotency key to transfer id, so a replayed key returns the first result. */
  private byIdempotencyKey = new Map<string, string>();
  private counter = 0;

  isConfigured(): boolean {
    // Same guard as the remittance stub: opt-in, and never in production.
    return process.env.BANKING_ENABLE_STUB === '1' && process.env.NODE_ENV !== 'production';
  }

  async createTransfer(request: BankTransferRequest): Promise<BankTransfer> {
    const invalid = validateTransferRequest(request);
    if (invalid) throw new Error(`Invalid transfer request: ${invalid}`);

    // Replaying a key returns the original transfer rather than making a second
    // one. This is the behaviour the real originators promise, and building
    // against a stub that does not honour it would hide a double-debit bug
    // until production.
    const existingId = this.byIdempotencyKey.get(request.idempotencyKey);
    if (existingId) {
      return this.transfers.get(existingId)!;
    }

    const id = `stub_txf_${++this.counter}`;
    const transfer: BankTransfer = {
      id,
      provider: this.id,
      direction: request.direction,
      amountMinor: request.amountMinor,
      currency: request.currency,
      status: 'initiated',
      providerStatus: 'INITIATED',
      returnCode: null,
      createdAt: new Date().toISOString(),
      settledAt: null,
    };

    this.transfers.set(id, transfer);
    this.byIdempotencyKey.set(request.idempotencyKey, id);
    return transfer;
  }

  async getTransfer(id: string): Promise<BankTransfer | null> {
    return this.transfers.get(id) ?? null;
  }

  /** Drive a transfer to a status, the way a webhook or a poll eventually would. */
  advance(id: string, status: TransferStatus, returnCode: string | null = null): BankTransfer {
    const transfer = this.transfers.get(id);
    if (!transfer) throw new Error(`No such transfer: ${id}`);

    const advanced: BankTransfer = {
      ...transfer,
      status,
      providerStatus: status.toUpperCase(),
      returnCode: status === 'returned' ? (returnCode ?? 'R01') : transfer.returnCode,
      settledAt:
        status === 'settled' || status === 'completed'
          ? (transfer.settledAt ?? new Date().toISOString())
          : transfer.settledAt,
    };

    this.transfers.set(id, advanced);
    return advanced;
  }

  /** Test seam. */
  reset(): void {
    this.transfers.clear();
    this.byIdempotencyKey.clear();
    this.counter = 0;
  }
}
