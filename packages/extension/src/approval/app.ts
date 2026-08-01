/**
 * Approval window — the single point where the user authorizes a batch.
 *
 * The whole premise of bulk paying is one confirmation instead of 62, so this
 * screen has to carry the weight that 62 individual confirmations used to:
 * it shows the requesting origin, per-chain totals, the grand total, and every
 * single recipient in a scrollable list. Nothing is hidden behind "and 59
 * more" — the list is exactly what will be signed.
 *
 * After approval the same window becomes the progress view, because a batch
 * takes minutes and closing it cancels the remainder.
 */

import { el, mount, button, note, brand } from '../popup/dom.js';
import { call } from '../popup/rpc.js';
import type { PendingApproval } from '../messages.js';
import type { BatchProgress, BatchFunding } from '../core/batch.js';

const params = new URLSearchParams(window.location.search);
const requestId = params.get('requestId') ?? '';

/** Live per-payment state, keyed by payment id, for in-place row updates. */
const rows = new Map<string, HTMLElement>();
const stages = new Map<string, BatchProgress>();
let approval: PendingApproval | null = null;

export async function start(): Promise<void> {
  if (!requestId) return renderMessage('Nothing to approve', 'This window was opened without a request.');

  try {
    const res = await call({ type: 'approval:get', requestId });
    if (!('approval' in res)) throw new Error('Request not found');
    approval = res.approval;
    render();
  } catch (err) {
    renderMessage('Request unavailable', err instanceof Error ? err.message : String(err));
  }
}

function render(): void {
  if (!approval) return;
  if (approval.kind === 'connect') return renderConnect(approval);
  return renderBatch(approval);
}

// ── Connect ──────────────────────────────────────────────────────────────────

function renderConnect(request: Extract<PendingApproval, { kind: 'connect' }>): void {
  const password = passwordField(request.needsUnlock);
  const status = note('Connecting lets this site see your wallet addresses and request payments. Every payment still needs your approval.');

  mount(
    brand('Connect wallet'),
    el('span', { class: 'origin', text: request.origin }),
    status,
    ...(password ? [password.row] : []),
    el('div', { class: 'row' }, [
      button('Reject', () => void decide(false), 'btn'),
      button(
        'Connect',
        () => void decide(true, password?.input.value, status),
        'btn primary',
      ),
    ]),
  );
}

// ── Batch payment ────────────────────────────────────────────────────────────

function renderBatch(request: Extract<PendingApproval, { kind: 'payBatch' }>): void {
  const password = passwordField(request.needsUnlock);
  const status = el('p', { class: 'muted' });

  const grandUsd = request.summary.reduce((sum, s) => sum + s.totalUsd, 0);
  const totals = el('div', { class: 'totals' }, [
    ...request.summary.map((s) =>
      el('div', { class: 'total-row' }, [
        el('span', { class: 'chain', text: `${s.chain} · ${s.count} payment${s.count === 1 ? '' : 's'}` }),
        el('span', { text: s.total }),
      ]),
    ),
    ...(grandUsd > 0
      ? [
          el('div', { class: 'total-row grand' }, [
            el('span', { text: `${request.payments.length} payments` }),
            el('span', { text: `≈ $${grandUsd.toFixed(2)}` }),
          ]),
        ]
      : []),
  ]);

  mount(
    brand('Confirm bulk payment'),
    el('span', { class: 'origin', text: request.origin }),
    el('p', {
      class: 'warn',
      text: `This sends ${request.payments.length} separate transactions. They cannot be reversed.`,
    }),
    totals,
    ...(request.funding?.length ? [buildFunding(request.funding)] : []),
    buildList(request),
    ...(password ? [password.row] : []),
    status,
    el('div', { class: 'row' }, [
      button('Reject', () => void decide(false), 'btn'),
      button(
        `Approve all (${request.payments.length})`,
        () => void decide(true, password?.input.value, status),
        'btn primary',
      ),
    ]),
  );
}

/**
 * What each funding address holds, against what the run needs.
 *
 * A short balance does not announce itself: the run starts, and each payment
 * fails with a chain-level message ("No UTXOs available", "simulation failed")
 * that never mentions money. Showing it here turns that into something the user
 * can see before approving 80 transactions.
 */
function buildFunding(funding: BatchFunding[]): HTMLElement {
  const short = funding.filter((f) => !f.sufficient);
  return el('div', { class: 'funding' }, [
    el('div', { class: 'funding-head', text: 'Paying from' }),
    ...funding.map((f) =>
      el('div', { class: f.sufficient ? 'funding-row' : 'funding-row short' }, [
        el('span', { class: 'who' }, [
          el('span', { class: 'chain', text: f.chain }),
          ...(f.address ? [el('span', { class: 'addr', text: shortenAddress(f.address) })] : []),
        ]),
        el('span', {
          class: 'amt',
          text: `need ${f.required} · have ${f.available}`,
        }),
      ]),
    ),
    ...(short.length
      ? [
          el('p', {
            class: 'warn',
            text:
              short.length === funding.length
                ? 'This address cannot cover the run. Fund it, or pick the address that holds the money, before approving.'
                : `Not enough ${short.map((f) => f.chain).join(', ')} to cover every payment — those will fail.`,
          }),
        ]
      : []),
    el('p', {
      class: 'muted',
      text: 'Balances exclude network fees, so a run can still come up short.',
    }),
  ]);
}

function buildList(request: Extract<PendingApproval, { kind: 'payBatch' }>): HTMLElement {
  rows.clear();
  const items = request.payments.map((payment) => {
    const stage = el('span', { class: 'stage', text: '' });
    const row = el('div', { class: 'item' }, [
      el('div', { class: 'who' }, [
        el('span', { class: 'label', text: payment.label || payment.id }),
        el('span', { class: 'addr', text: shortenAddress(payment.to) }),
      ]),
      el('div', { class: 'amt' }, [
        el('span', { text: `${payment.amount} ${payment.chain}` }),
        stage,
      ]),
    ]);
    rows.set(payment.id, row);
    return row;
  });
  return el('div', { class: 'list' }, items);
}

function shortenAddress(address: string): string {
  return address.length <= 20 ? address : `${address.slice(0, 10)}…${address.slice(-8)}`;
}

// ── Decision ─────────────────────────────────────────────────────────────────

async function decide(approve: boolean, password?: string, status?: HTMLElement): Promise<void> {
  if (!approve) {
    await call({ type: 'approval:reject', requestId }).catch(() => {});
    window.close();
    return;
  }

  try {
    await call({ type: 'approval:approve', requestId, password });
  } catch (err) {
    // Almost always a wrong password — keep the window open so they can retry.
    if (status) {
      status.textContent = err instanceof Error ? err.message : String(err);
      status.className = 'err';
    }
    return;
  }

  if (approval?.kind === 'payBatch') renderProgress(approval);
  else window.close();
}

// ── Progress ─────────────────────────────────────────────────────────────────

function renderProgress(request: Extract<PendingApproval, { kind: 'payBatch' }>): void {
  const total = request.payments.length;
  const bar = el('div', {}, []);
  const counter = el('p', { class: 'muted', text: `Sending 0 of ${total}…` });
  const list = buildList(request);
  // Reflect anything that arrived between approval and this render.
  for (const progress of stages.values()) applyProgress(progress);

  // The same button is "stop" while the run is live and "close" once it ends,
  // so its action has to follow that switch.
  let finished = false;
  const cancel = button(
    'Stop after current payment',
    () => {
      if (finished) return window.close();
      void call({ type: 'approval:cancel', requestId }).catch(() => {});
      cancel.disabled = true;
      cancel.textContent = 'Stopping…';
    },
    'btn danger',
  );

  mount(
    brand('Sending payments'),
    el('span', { class: 'origin', text: request.origin }),
    el('p', { class: 'muted small', text: 'Keep this window open until it finishes. Closing it cancels the payments that have not been sent yet.' }),
    el('div', { class: 'progress-bar' }, [bar]),
    counter,
    list,
    el('div', { class: 'row' }, [cancel]),
  );

  const update = (progress: BatchProgress): void => {
    applyProgress(progress);
    const pct = Math.round((progress.completed / progress.total) * 100);
    bar.setAttribute('style', `width:${pct}%`);
    counter.textContent =
      progress.completed >= progress.total
        ? summarize()
        : `Sending ${progress.completed + 1} of ${progress.total}…`;
    if (progress.completed >= progress.total) {
      finished = true;
      cancel.textContent = 'Close';
      cancel.disabled = false;
      cancel.className = 'btn primary';
    }
  };

  for (const progress of stages.values()) update(progress);
  progressHandlers.add(update);
}

function summarize(): string {
  let sent = 0;
  let failed = 0;
  for (const progress of stages.values()) {
    if (progress.stage === 'sent') sent++;
    else if (progress.stage === 'failed' || progress.stage === 'skipped') failed++;
  }
  return failed === 0
    ? `All ${sent} payments sent.`
    : `${sent} sent, ${failed} not sent — see the list below.`;
}

function applyProgress(progress: BatchProgress): void {
  const row = rows.get(progress.id);
  if (!row) return;
  const stage = row.querySelector('.stage');
  if (stage) stage.textContent = stageLabel(progress);
  row.className = `item ${progress.stage === 'sent' ? 'sent' : ''}${
    progress.stage === 'failed' || progress.stage === 'skipped' ? 'failed' : ''
  }`.trim();
}

function stageLabel(progress: BatchProgress): string {
  switch (progress.stage) {
    case 'queued':
      return 'waiting';
    case 'preparing':
      return 'preparing…';
    case 'signing':
      return 'signing…';
    case 'broadcasting':
      return 'broadcasting…';
    case 'sent':
      return progress.txHash ? `sent · ${progress.txHash.slice(0, 10)}…` : 'sent';
    case 'skipped':
      return 'cancelled';
    case 'failed':
      return progress.error ? `failed · ${progress.error.slice(0, 40)}` : 'failed';
  }
}

const progressHandlers = new Set<(progress: BatchProgress) => void>();

chrome.runtime.onMessage.addListener((message: any) => {
  if (message?.type === 'coinpay:progress' && message.requestId === requestId) {
    stages.set(message.progress.id, message.progress);
    for (const handler of progressHandlers) handler(message.progress);
  }
  // The background finished and tore the request down; nothing left to show.
  if (message?.type === 'coinpay:approvalResolved' && message.requestId === requestId) {
    progressHandlers.clear();
  }
});

// ── helpers ──────────────────────────────────────────────────────────────────

function passwordField(needed: boolean): { row: HTMLElement; input: HTMLInputElement } | null {
  if (!needed) return null;
  const input = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const row = el('label', { class: 'field' }, [
    el('span', { class: 'label-text', text: 'Wallet password' }),
    input,
  ]);
  return { row, input };
}

function renderMessage(title: string, message: string): void {
  mount(
    brand(title),
    note(message),
    el('div', { class: 'row' }, [button('Close', () => window.close(), 'btn')]),
  );
}
