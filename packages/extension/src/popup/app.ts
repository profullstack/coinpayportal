/**
 * Popup controller — a small state machine driving the Phase-1 wallet UX:
 *   welcome → (create: backup → confirm → set password) | (import) → wallet
 *   locked  → unlock → wallet
 *
 * All wallet operations go through the background service worker (rpc); the
 * popup never holds the encrypted vault or derives keys itself. The plaintext
 * mnemonic is shown only during the create/backup flow and is discarded when
 * the flow completes or is cancelled.
 */

import { wordlist } from '@scure/bip39/wordlists/english';
import type { DerivedAddress } from '../core/derivation.js';
import { pickIndices, makeChoices } from '../core/backup.js';
import { call } from './rpc.js';
import { el, mount, button, field, note } from './dom.js';

interface CreateFlow {
  mnemonic: string;
  words: string[];
  preview: DerivedAddress[];
}

let flow: CreateFlow | null = null;

/** Entry point — decide the initial view from wallet state. */
export async function start(): Promise<void> {
  try {
    const res = await call({ type: 'getState' });
    const state = 'state' in res ? res.state : { initialized: false, unlocked: false };
    if (!state.initialized) return renderWelcome();
    if (!state.unlocked) return renderUnlock();
    return renderWallet();
  } catch (err) {
    renderError(err);
  }
}

// ── Welcome ────────────────────────────────────────────────────────────────

function renderWelcome(): void {
  mount(
    header('CoinPay Wallet'),
    note('Non-custodial. Your keys never leave this device.'),
    el('div', { class: 'stack' }, [
      button('Create new wallet', () => void beginCreate(), 'btn primary'),
      button('Import existing wallet', () => renderImport(), 'btn'),
    ]),
  );
}

// ── Create: backup ───────────────────────────────────────────────────────────

async function beginCreate(): Promise<void> {
  try {
    const res = await call({ type: 'beginCreate', words: 12 });
    if (!('mnemonic' in res)) throw new Error('Unexpected response');
    flow = { mnemonic: res.mnemonic, words: res.mnemonic.split(' '), preview: res.accounts };
    renderBackup();
  } catch (err) {
    renderError(err);
  }
}

function renderBackup(): void {
  if (!flow) return renderWelcome();
  const grid = el(
    'ol',
    { class: 'seed' },
    flow.words.map((w) => el('li', { class: 'word', text: w })),
  );
  mount(
    header('Back up your recovery phrase'),
    note('Write these 12 words down in order and keep them somewhere safe. Anyone with this phrase can spend your funds.', 'warn'),
    grid,
    el('div', { class: 'row' }, [
      button('Cancel', () => void cancel(), 'btn'),
      button("I've saved it", () => renderConfirm(), 'btn primary'),
    ]),
  );
}

// ── Create: confirm backup ───────────────────────────────────────────────────

function renderConfirm(): void {
  if (!flow) return renderWelcome();
  const indices = pickIndices(flow.words.length, 3);
  const selected = new Map<number, string>();
  const status = note('Select the correct word for each position.');

  const questions = indices.map((idx) => {
    const choices = makeChoices(flow!.words, idx, wordlist, 2);
    const btns: HTMLButtonElement[] = [];
    for (const word of choices) {
      const b = button(word, () => {
        for (const other of btns) other.classList.remove('selected');
        b.classList.add('selected');
        selected.set(idx, word);
      }, 'btn choice');
      btns.push(b);
    }
    return el('div', { class: 'confirm-q' }, [
      el('span', { class: 'label', text: `Word #${idx + 1}` }),
      el('div', { class: 'choices' }, btns),
    ]);
  });

  mount(
    header('Confirm your backup'),
    ...questions,
    status,
    el('div', { class: 'row' }, [
      button('Back', () => renderBackup(), 'btn'),
      button('Verify', () => {
        const allCorrect = indices.every((idx) => selected.get(idx) === flow!.words[idx]);
        if (allCorrect) return renderSetPassword();
        status.textContent = "That doesn't match your phrase. Try again.";
        status.className = 'err';
      }, 'btn primary'),
    ]),
  );
}

// ── Create: set password ─────────────────────────────────────────────────────

function renderSetPassword(): void {
  const pw = field('Password', { type: 'password', autocomplete: 'new-password' });
  const pw2 = field('Confirm password', { type: 'password', autocomplete: 'new-password' });
  const status = note('This password encrypts your wallet on this device.');

  mount(
    header('Set a password'),
    pw.row,
    pw2.row,
    status,
    el('div', { class: 'row' }, [
      button('Cancel', () => void cancel(), 'btn'),
      button('Finish', async () => {
        const p = pw.input.value;
        if (p.length < 8) return fail(status, 'Use at least 8 characters.');
        if (p !== pw2.input.value) return fail(status, 'Passwords do not match.');
        try {
          await call({ type: 'confirmCreate', password: p });
          flow = null;
          renderWallet();
        } catch (err) {
          fail(status, err instanceof Error ? err.message : String(err));
        }
      }, 'btn primary'),
    ]),
  );
}

// ── Import ───────────────────────────────────────────────────────────────────

function renderImport(): void {
  const phrase = el('textarea', { class: 'input textarea', rows: '3', placeholder: '12 or 24 words separated by spaces', autocomplete: 'off', spellcheck: 'false' });
  const pw = field('Password', { type: 'password', autocomplete: 'new-password' });
  const pw2 = field('Confirm password', { type: 'password', autocomplete: 'new-password' });
  const status = note('Your phrase is encrypted locally and never uploaded.');

  mount(
    header('Import wallet'),
    el('label', { class: 'field' }, [el('span', { class: 'label', text: 'Recovery phrase' }), phrase]),
    pw.row,
    pw2.row,
    status,
    el('div', { class: 'row' }, [
      button('Back', () => renderWelcome(), 'btn'),
      button('Import', async () => {
        const p = pw.input.value;
        if (p.length < 8) return fail(status, 'Use at least 8 characters.');
        if (p !== pw2.input.value) return fail(status, 'Passwords do not match.');
        try {
          await call({ type: 'import', mnemonic: phrase.value, password: p });
          renderWallet();
        } catch (err) {
          fail(status, err instanceof Error ? err.message : String(err));
        }
      }, 'btn primary'),
    ]),
  );
}

// ── Unlock ───────────────────────────────────────────────────────────────────

function renderUnlock(): void {
  const pw = field('Password', { type: 'password', autocomplete: 'current-password' });
  const status = note('Enter your password to unlock.');
  const submit = async () => {
    try {
      await call({ type: 'unlock', password: pw.input.value });
      renderWallet();
    } catch (err) {
      fail(status, err instanceof Error ? err.message : String(err));
    }
  };
  pw.input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void submit();
  });
  mount(header('Unlock'), pw.row, status, el('div', { class: 'row' }, [button('Unlock', () => void submit(), 'btn primary')]));
}

// ── Wallet ───────────────────────────────────────────────────────────────────

async function renderWallet(): Promise<void> {
  try {
    const res = await call({ type: 'getAccounts' });
    const accounts = 'accounts' in res ? res.accounts : [];
    const rows = accounts.map((a) =>
      el('div', { class: 'account' }, [
        el('div', { class: 'acct-head' }, [
          el('span', { class: 'chain', text: a.chain }),
          a.tokens.length ? el('span', { class: 'tokens', text: '+ ' + a.tokens.join(', ') }) : el('span', {}),
        ]),
        el('code', { class: 'addr', text: a.address }),
      ]),
    );
    mount(
      el('div', { class: 'topbar' }, [
        el('h1', { class: 'title', text: 'CoinPay' }),
        button('Lock', async () => {
          await call({ type: 'lock' });
          renderUnlock();
        }, 'btn small'),
      ]),
      el('div', { class: 'accounts' }, rows.length ? rows : [note('No accounts yet.')]),
      note('Send and x402 payments arrive in a later update.', 'muted small'),
    );
  } catch (err) {
    renderError(err);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function header(title: string): HTMLElement {
  return el('h1', { class: 'title', text: title });
}

function fail(status: HTMLElement, msg: string): void {
  status.textContent = msg;
  status.className = 'err';
}

async function cancel(): Promise<void> {
  try {
    await call({ type: 'cancelCreate' });
  } catch {
    /* ignore */
  }
  flow = null;
  renderWelcome();
}

function renderError(err: unknown): void {
  mount(header('Something went wrong'), note(err instanceof Error ? err.message : String(err), 'err'), el('div', { class: 'row' }, [button('Reload', () => void start(), 'btn')]));
}
