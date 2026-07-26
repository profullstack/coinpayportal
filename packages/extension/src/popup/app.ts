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
import { PAY_CHAINS, signingChain, payChainLabel, payChainTicker, type PayChain } from '../core/pay-chains.js';
import { dialogConfirm, dialogPrompt, dialogAlert } from './dialog.js';
import type { RateQuote } from '../core/rates.js';
import {
  FIAT_CURRENCIES,
  DEFAULT_FIAT,
  cryptoToFiat,
  fiatToCrypto,
  formatFiat,
  formatCrypto,
  type FiatCurrency,
} from '../core/fiat.js';

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

type Tab = 'wallet' | 'send' | 'settings';
let activeTab: Tab = 'wallet';

async function renderWallet(): Promise<void> {
  try {
    const [accountsRes, listRes] = await Promise.all([
      call({ type: 'getAccounts' }),
      call({ type: 'listAccounts' }),
    ]);
    const addresses = 'accounts' in accountsRes ? accountsRes.accounts : [];
    const walletAccounts = 'walletAccounts' in listRes ? listRes.walletAccounts : [{ index: 0, label: 'Account 1' }];
    const active = 'activeAccount' in listRes ? listRes.activeAccount : 0;

    mount(
      el('div', { class: 'topbar' }, [
        el('h1', { class: 'title', text: 'CoinPay' }),
        button('Lock', async () => {
          await call({ type: 'lock' });
          renderUnlock();
        }, 'btn small'),
      ]),
      accountSwitcher(walletAccounts, active),
      tabs(),
      activeTab === 'wallet' ? addressList(addresses)
        : activeTab === 'send' ? sendForm(addresses)
        : settingsPanel(),
    );
  } catch (err) {
    renderError(err);
  }
}

/** MetaMask-style account picker: one seed, many derived accounts. */
function accountSwitcher(accounts: { index: number; label: string }[], active: number): HTMLElement {
  const select = el('select', { class: 'acct-select' }) as HTMLSelectElement;
  for (const a of accounts) {
    const opt = el('option', { text: a.label, value: String(a.index) }) as HTMLOptionElement;
    if (a.index === active) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener('change', async () => {
    await call({ type: 'selectAccount', index: Number(select.value) });
    void renderWallet();
  });

  return el('div', { class: 'acct-bar' }, [
    select,
    button('+ Add', async () => {
      const label = await dialogPrompt({
        title: 'Add account',
        label: 'Name',
        placeholder: `Account ${accounts.length + 1}`,
        confirmLabel: 'Add',
      });
      const res = await call({ type: 'addAccount', ...(label ? { label } : {}) });
      if (!res.ok) { await dialogAlert({ title: "Couldn't add account", message: res.error, tone: 'error' }); return; }
      void renderWallet();
    }, 'btn small'),
    button('Rename', async () => {
      const current = accounts.find((a) => a.index === active);
      const label = await dialogPrompt({
        title: 'Rename account',
        label: 'Name',
        value: current?.label ?? '',
        confirmLabel: 'Rename',
      });
      if (!label) return;
      const res = await call({ type: 'renameAccount', index: active, label });
      if (!res.ok) { await dialogAlert({ title: "Couldn't rename", message: res.error, tone: 'error' }); return; }
      void renderWallet();
    }, 'btn small'),
    // Only offered when there is another account to fall back to; removing the
    // last one would leave the wallet with nothing to show.
    ...(accounts.length > 1
      ? [button('Remove', async () => {
          const current = accounts.find((a) => a.index === active);
          const confirmed = await dialogConfirm({
            title: `Remove ${current?.label ?? 'this account'}?`,
            message:
              'This hides the account from your wallet. It does not delete anything: the addresses come from your recovery phrase, so any funds there stay recoverable with that phrase. Check the balance before removing.',
            details: [{ label: 'Account', value: current?.label ?? String(active) }],
            confirmLabel: 'Remove',
            danger: true,
          });
          if (!confirmed) return;
          const res = await call({ type: 'removeAccount', index: active });
          if (!res.ok) { await dialogAlert({ title: "Couldn't remove", message: res.error, tone: 'error' }); return; }
          void renderWallet();
        }, 'btn small')]
      : []),
  ]);
}

function tabs(): HTMLElement {
  const mk = (id: Tab, label: string) =>
    button(label, () => { activeTab = id; void renderWallet(); }, `btn tab${activeTab === id ? ' active' : ''}`);
  return el('div', { class: 'tabs' }, [mk('wallet', 'Wallet'), mk('send', 'Send'), mk('settings', 'Settings')]);
}

function addressList(addresses: DerivedAddress[]): HTMLElement {
  const rows = addresses.map((a) =>
    el('div', { class: 'account' }, [
      el('div', { class: 'acct-head' }, [
        el('span', { class: 'chain', text: a.chain }),
        a.tokens.length ? el('span', { class: 'tokens', text: '+ ' + a.tokens.join(', ') }) : el('span', {}),
      ]),
      el('code', { class: 'addr', text: a.address }),
      button('Copy', () => { void navigator.clipboard.writeText(a.address); }, 'btn small'),
    ]),
  );
  return el('div', { class: 'accounts' }, rows.length ? rows : [note('No accounts yet.')]);
}

/**
 * User-initiated send — the wallet paying out, not a site asking it to.
 *
 * The amount can be entered in the coin or in the user's display currency; the
 * chain always moves crypto, so a fiat entry is converted at the live rate and
 * BOTH numbers are shown on the confirmation before anything is signed.
 */
function sendForm(addresses: DerivedAddress[]): HTMLElement {
  const chain = el('select', { class: 'acct-select' }) as HTMLSelectElement;
  for (const c of PAY_CHAINS) {
    // Only offer chains this account actually holds an address for — a token
    // like USDC_POL signs with, and is listed under, its native chain.
    if (!addresses.some((a) => a.chain === signingChain(c))) continue;
    chain.append(el('option', { text: payChainLabel(c), value: c }) as HTMLOptionElement);
  }

  const to = field('Recipient address', { placeholder: 'Paste an address' });
  const amount = field('Amount', { placeholder: '0.00', inputmode: 'decimal' });
  const amountLabel = amount.row.querySelector('.label') as HTMLElement;
  const status = note('', 'muted small');

  // ── live pricing ────────────────────────────────────────────────────────
  let fiat: FiatCurrency = DEFAULT_FIAT;
  let quote: RateQuote | null = null;
  let unit: 'crypto' | 'fiat' = 'crypto';
  /** Bumped on every chain/currency change so a stale response can't land. */
  let quoteToken = 0;

  const estimate = note('Loading rate…', 'muted small');
  const toggle = button('', () => {
    unit = unit === 'crypto' ? 'fiat' : 'crypto';
    // Carry the value across the switch rather than clearing it — the user
    // typed an amount, not a unit.
    const entered = Number(amount.input.value.trim());
    if (quote && Number.isFinite(entered) && entered > 0) {
      const converted =
        unit === 'fiat' ? cryptoToFiat(entered, quote.rate) : fiatToCrypto(entered, quote.rate);
      if (converted !== null) {
        amount.input.value = unit === 'fiat' ? converted.toFixed(2) : formatCrypto(converted);
      }
    }
    renderPricing();
  }, 'btn small');

  const ticker = () => (chain.value ? payChainTicker(chain.value as PayChain) : '');

  /** Amount to actually send, in coin units — null when it can't be resolved. */
  function cryptoAmount(): string | null {
    const raw = amount.input.value.trim();
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return null;
    if (unit === 'crypto') return raw;
    if (!quote) return null;
    const converted = fiatToCrypto(value, quote.rate);
    return converted === null ? null : formatCrypto(converted);
  }

  function renderPricing(): void {
    const coin = ticker();
    amountLabel.textContent = `Amount (${unit === 'crypto' ? coin : fiat})`;
    toggle.textContent = unit === 'crypto' ? `Enter in ${fiat}` : `Enter in ${coin}`;
    toggle.disabled = !quote;

    if (!quote) {
      // Without a rate the fiat path would be a guess, so it stays closed.
      estimate.className = 'muted small';
      return;
    }

    const entered = Number(amount.input.value.trim());
    const hasAmount = Number.isFinite(entered) && entered > 0;
    estimate.className = 'muted small';

    if (!hasAmount) {
      estimate.textContent = `1 ${coin} ≈ ${formatFiat(quote.rate, fiat)} ${fiat}`;
      return;
    }
    if (unit === 'crypto') {
      const value = cryptoToFiat(entered, quote.rate);
      estimate.textContent = value === null ? '' : `≈ ${formatFiat(value, fiat)} ${fiat}`;
    } else {
      const coins = fiatToCrypto(entered, quote.rate);
      estimate.textContent = coins === null ? '' : `≈ ${formatCrypto(coins)} ${coin}`;
    }
  }

  async function refreshQuote(): Promise<void> {
    const token = ++quoteToken;
    const coin = chain.value;
    if (!coin) {
      // No sendable chain for this account — nothing to price.
      quote = null;
      estimate.textContent = '';
      return;
    }
    quote = null;
    estimate.textContent = 'Loading rate…';
    renderPricing();

    // Read the display currency separately from the rate: it comes from local
    // storage, so the labels stay correct even when the price feed is down.
    try {
      const res = await call({ type: 'getSettings' });
      if (token !== quoteToken) return;
      if ('settings' in res) fiat = res.settings.fiatCurrency;
    } catch {
      /* keep the default */
    }

    try {
      const res = await call({ type: 'getRate', coin, fiat });
      if (token !== quoteToken) return; // chain/currency changed under us
      if ('quote' in res) quote = res.quote;
    } catch {
      if (token !== quoteToken) return;
    }

    if (!quote) {
      // Without a rate the fiat entry mode would be guesswork, so drop out of it.
      if (unit === 'fiat') unit = 'crypto';
      renderPricing();
      estimate.textContent = `Live ${fiat} rate unavailable — enter the amount in ${ticker()}.`;
      return;
    }
    renderPricing();
  }

  chain.addEventListener('change', () => void refreshQuote());
  amount.input.addEventListener('input', () => renderPricing());
  void refreshQuote();

  const submit = button('Review & send', async () => {
    status.className = 'muted small';
    status.textContent = '';
    const chainValue = chain.value;
    const toValue = to.input.value.trim();
    const amountValue = cryptoAmount();
    if (!chainValue || !toValue || !amountValue) {
      fail(status, 'Chain, recipient and a valid amount are all required.');
      return;
    }
    const coin = payChainTicker(chainValue as PayChain);
    const fiatValue = quote ? cryptoToFiat(amountValue, quote.rate) : null;
    const confirmed = await dialogConfirm({
      title: 'Confirm payment',
      message: 'On-chain transfers cannot be undone. Check the recipient carefully.',
      details: [
        { label: 'Amount', value: `${amountValue} ${coin}` },
        ...(fiatValue === null
          ? []
          : [{ label: `Value (${fiat})`, value: `≈ ${formatFiat(fiatValue, fiat)}` }]),
        { label: 'Chain', value: payChainLabel(chainValue as PayChain) },
        { label: 'To', value: toValue },
      ],
      confirmLabel: 'Send',
      danger: true,
    });
    if (!confirmed) return;

    submit.disabled = true;
    status.textContent = 'Sending…';
    try {
      const res = await call({ type: 'send', chain: chainValue, to: toValue, amount: amountValue });
      if (!res.ok) { fail(status, res.error); submit.disabled = false; return; }
      const sent = 'sent' in res ? res.sent : null;
      status.className = 'ok small';
      status.textContent = sent?.txHash ? `Sent — ${sent.txHash}` : 'Sent.';
      to.input.value = '';
      amount.input.value = '';
      renderPricing();
    } catch (err) {
      fail(status, err instanceof Error ? err.message : String(err));
    } finally {
      submit.disabled = false;
    }
  });

  return el('div', { class: 'send' }, [
    el('label', { class: 'lbl', text: 'Chain' }),
    chain,
    to.row,
    amount.row,
    el('div', { class: 'rate-row' }, [estimate, toggle]),
    submit,
    status,
  ]);
}

function settingsPanel(): HTMLElement {
  const container = el('div', { class: 'settings' }, [note('Loading…', 'muted small')]);

  void (async () => {
    const [settingsRes, connRes] = await Promise.all([
      call({ type: 'getSettings' }),
      call({ type: 'listConnections' }),
    ]);
    const minutes = 'settings' in settingsRes ? settingsRes.settings.autoLockMinutes : 15;
    const currency = 'settings' in settingsRes ? settingsRes.settings.fiatCurrency : DEFAULT_FIAT;
    const conns = 'connections' in connRes ? connRes.connections : [];

    const lockAfter = field('Auto-lock after (minutes)', { value: String(minutes), inputmode: 'numeric' });
    const status = note('', 'muted small');

    // Display currency — every fiat amount in the wallet is quoted in this.
    const fiatSelect = el('select', { class: 'acct-select' }) as HTMLSelectElement;
    for (const c of FIAT_CURRENCIES) {
      const opt = el('option', { text: `${c.code} — ${c.name}`, value: c.code }) as HTMLOptionElement;
      if (c.code === currency) opt.selected = true;
      fiatSelect.append(opt);
    }

    const sites = conns.length
      ? conns.map((c) =>
          el('div', { class: 'account' }, [
            el('code', { class: 'addr', text: c.origin }),
            button('Disconnect', async () => {
              await call({ type: 'disconnectSite', origin: c.origin });
              void renderWallet();
            }, 'btn small'),
          ]),
        )
      : [note('No sites connected.', 'muted small')];

    container.replaceChildren(
      el('h2', { class: 'lbl', text: 'Security' }),
      lockAfter.row,
      el('h2', { class: 'lbl', text: 'Display currency' }),
      fiatSelect,
      note('Amounts are priced in this currency. Transfers always move crypto.', 'muted small'),
      button('Save', async () => {
        const value = Number(lockAfter.input.value);
        if (!Number.isFinite(value) || value < 1) { fail(status, 'Enter a number of minutes (1 or more).'); return; }
        try {
          await call({ type: 'setAutoLockMinutes', minutes: value });
          await call({ type: 'setFiatCurrency', currency: fiatSelect.value });
          status.className = 'ok small';
          status.textContent = 'Saved.';
        } catch (err) {
          // `call` throws on `{ ok: false }`, so a rejected save lands here.
          status.className = 'error small';
          status.textContent = err instanceof Error ? err.message : String(err);
        }
      }),
      status,
      el('h2', { class: 'lbl', text: 'Connected sites' }),
      ...sites,
    );
  })();

  return container;
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
