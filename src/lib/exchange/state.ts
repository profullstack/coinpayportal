/**
 * Order state machine.
 *
 *   created -> awaiting_user_action -> submitted -> pending -> completed
 *
 * with expired / cancelled / failed / refund_pending / refunded / manual_review
 * as exception states. Provider updates that would move an order backwards or
 * out of a terminal state are refused, so a late or replayed webhook/poll can
 * never resurrect a finished order.
 */

import type { ExchangeOrderStatus } from './types';

const TRANSITIONS: Record<ExchangeOrderStatus, ExchangeOrderStatus[]> = {
  created: ['awaiting_user_action', 'failed', 'cancelled', 'expired'],
  awaiting_user_action: ['submitted', 'pending', 'expired', 'cancelled', 'failed', 'completed', 'manual_review'],
  submitted: ['pending', 'completed', 'failed', 'refund_pending', 'refunded', 'manual_review'],
  pending: ['completed', 'failed', 'refund_pending', 'refunded', 'manual_review'],
  refund_pending: ['refunded', 'manual_review', 'failed'],
  manual_review: ['pending', 'completed', 'failed', 'refund_pending', 'refunded'],
  completed: [],
  expired: [],
  cancelled: [],
  failed: [],
  refunded: [],
};

export const TERMINAL_STATUSES: ReadonlySet<ExchangeOrderStatus> = new Set([
  'completed', 'expired', 'cancelled', 'failed', 'refunded',
]);

export function canTransition(from: ExchangeOrderStatus, to: ExchangeOrderStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ExchangeOrderStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Only orders still waiting on the user may be cancelled by the user. */
export function isCancellable(status: ExchangeOrderStatus): boolean {
  return status === 'created' || status === 'awaiting_user_action';
}
