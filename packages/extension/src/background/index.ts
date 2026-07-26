/**
 * Background service worker (MV3) — the only context that holds seed material.
 *
 * Responsibilities:
 *   - Wire `WalletService` to `browser.storage.local` (encrypted vault) and
 *     `browser.storage.session` (unlocked seed).
 *   - Route popup requests (create / import / unlock / lock / getState).
 *   - Idle auto-lock via `alarms` (PRD P0-3, default 15 min).
 *   - Serve connected web pages: connect, read addresses, and run batch
 *     payments — each gated behind an explicit approval window.
 *
 * Security posture for page-originated (`site:`) requests:
 *   - The origin comes from `sender`, never from the message body, so a page
 *     cannot claim to be a different site.
 *   - Connecting grants read access to public addresses only.
 *   - EVERY payment batch opens its own approval window showing the full list
 *     and totals. A connected page can ask; only the user can authorize.
 *   - Approving requires the wallet to be unlocked (password prompt inline),
 *     and the seed never leaves this worker.
 *
 * `chrome.*` is used directly here; it exists in Chromium and Firefox MV3 for
 * the storage/alarms/runtime APIs used below. A `webextension-polyfill` layer
 * (per PRD §9) can be swapped in without touching the core modules.
 */

import { WalletService } from '../core/wallet.js';
import { WebExtStorage, type WebExtStorageArea } from '../core/storage.js';
import { ConnectionStore, normalizeOrigin } from '../core/connections.js';
import { CoinPayApi, compressedPublicKey } from '../core/api.js';
import { RateCache } from '../core/rates.js';
import { toFiatCurrency, type FiatCurrency } from '../core/fiat.js';
import { derivePrivateKey, derivationPath } from '../core/private-keys.js';
import { runBatchPayments, summarizeBatch, parseBatchRequests, type BatchItemResult } from '../core/batch.js';
import { PAY_CHAINS, signingChain, toPayChain } from '../core/pay-chains.js';
import type { NativeChain } from '../core/chains.js';
import type { WalletRequest, WalletResponse, PendingApproval, WalletEvent } from '../messages.js';

const AUTO_LOCK_ALARM = 'coinpay-auto-lock';
const DEFAULT_IDLE_MINUTES = 15;
/** Pre-multi-account: one id for the whole install. Migrated away from below. */
const LOCAL_PORTAL_WALLET_ID = 'portalWalletId';
/** `{ [accountIndex]: walletId }` — one portal wallet per BIP-44 account. */
const LOCAL_PORTAL_WALLET_IDS = 'portalWalletIds';
const SESSION_APPROVALS = 'pendingApprovals';
/** A batch of 62 payments takes minutes; cap the whole run, not each payment. */
const MAX_BATCH_SIZE = 500;

// chrome.storage promise API — cast to our minimal area interface.
const local = new WebExtStorage(chrome.storage.local as unknown as WebExtStorageArea);
const session = new WebExtStorage(chrome.storage.session as unknown as WebExtStorageArea);
const wallet = new WalletService(local, session);
const connections = new ConnectionStore(local);
const api = new CoinPayApi();
const rates = new RateCache(api);

const LOCAL_AUTO_LOCK_MINUTES = 'autoLockMinutes';
const LOCAL_FIAT_CURRENCY = 'fiatCurrency';

async function autoLockMinutes(): Promise<number> {
  const stored = await local.get<number>(LOCAL_AUTO_LOCK_MINUTES);
  return typeof stored === 'number' && stored > 0 ? stored : DEFAULT_IDLE_MINUTES;
}

/** The user's display currency; USD until they choose otherwise. */
async function fiatCurrency(): Promise<FiatCurrency> {
  return toFiatCurrency(await local.get<string>(LOCAL_FIAT_CURRENCY));
}

function scheduleAutoLock(minutes?: number): void {
  if (typeof minutes === 'number') {
    chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: minutes });
    return;
  }
  // Honour the user's configured timeout; fall back to the default if unset.
  void autoLockMinutes().then((m) => chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: m }));
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) void wallet.lock();
});

// Runs on every worker start; cheap, and idempotent once the key is gone.
void migrateLegacyPortalWallet();

// ── Pending approvals ────────────────────────────────────────────────────────

/**
 * Resolvers live in memory (functions aren't serializable) while the request
 * DETAILS are mirrored into session storage, so the approval window can still
 * render itself if the service worker is recycled while it is open. If the
 * worker dies the resolver is lost and the page's promise rejects — the user
 * sees an error and can retry, which is the safe direction to fail.
 */
interface ApprovalEntry {
  approval: PendingApproval;
  windowId?: number;
  resolve: (approved: boolean) => void;
  settled: boolean;
  abort: AbortController;
}

const pending = new Map<string, ApprovalEntry>();

async function persistApprovals(): Promise<void> {
  const snapshot: Record<string, PendingApproval> = {};
  for (const [id, entry] of pending) snapshot[id] = entry.approval;
  await session.set(SESSION_APPROVALS, snapshot);
}

async function readApproval(requestId: string): Promise<PendingApproval | undefined> {
  const inMemory = pending.get(requestId);
  if (inMemory) return inMemory.approval;
  const snapshot = await session.get<Record<string, PendingApproval>>(SESSION_APPROVALS);
  return snapshot?.[requestId];
}

function newRequestId(): string {
  return crypto.randomUUID();
}

function broadcast(event: WalletEvent): void {
  // Extension pages (the approval window) listen on runtime messages. There may
  // be no listener yet — swallow the resulting rejection.
  chrome.runtime.sendMessage(event).catch(() => {});
}

/**
 * Open the approval window and resolve once the user decides. Closing the
 * window without deciding counts as a rejection — silence is never consent.
 */
async function requestApproval(approval: PendingApproval): Promise<boolean> {
  const entry: ApprovalEntry = {
    approval,
    resolve: () => {},
    settled: false,
    abort: new AbortController(),
  };

  const decision = new Promise<boolean>((resolve) => {
    entry.resolve = resolve;
  });

  pending.set(approval.requestId, entry);
  await persistApprovals();

  const url = chrome.runtime.getURL(`approval/index.html?requestId=${approval.requestId}`);
  try {
    const window = await chrome.windows.create({
      url,
      type: 'popup',
      width: 460,
      height: 680,
      focused: true,
    });
    entry.windowId = window?.id;
  } catch {
    settleApproval(approval.requestId, false);
  }

  return decision;
}

function settleApproval(requestId: string, approved: boolean): void {
  const entry = pending.get(requestId);
  if (!entry || entry.settled) return;
  entry.settled = true;
  entry.resolve(approved);
}

/**
 * Drop a finished request.
 *
 * `closeWindow` is false after a batch runs: the window has become the results
 * view, and some payments may have failed. Yanking it away would hide the only
 * per-payment error detail the wallet shows, so the user closes it themselves.
 * A rejected or connect request has nothing left to display and is closed here.
 */
async function clearApproval(requestId: string, closeWindow = true): Promise<void> {
  const entry = pending.get(requestId);
  pending.delete(requestId);
  await persistApprovals();
  broadcast({ type: 'coinpay:approvalResolved', requestId });
  if (closeWindow && entry?.windowId !== undefined) {
    try {
      await chrome.windows.remove(entry.windowId);
    } catch {
      // Already closed by the user.
    }
  }
}

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [requestId, entry] of pending) {
    if (entry.windowId === windowId) {
      // Closing the window mid-run cancels the remainder; already-sent payments
      // cannot be recalled, and the results still come back to the page.
      entry.abort.abort();
      settleApproval(requestId, false);
    }
  }
});

// ── Portal registration ──────────────────────────────────────────────────────

/**
 * The portal's prepare-tx/broadcast endpoints work against a registered wallet.
 * Registration is non-custodial — public keys, addresses, and a signature
 * proving we hold the key. Done once PER ACCOUNT, then cached.
 *
 * Per account, not per install: the portal keys a wallet by its secp256k1
 * public key, and each BIP-44 account has its own. Registering account 2's
 * addresses under account 0's key (what this did before) left the portal with
 * addresses that do not belong to the key authorizing them.
 *
 * Every chain we might pay on is registered, including token chains: prepare-tx
 * verifies `from_address` against the exact chain, so USDC_POL needs its own
 * row even though it reuses the EVM address.
 */
async function ensurePortalWallet(seed: Uint8Array, accountIndex: number): Promise<string> {
  const ids = (await local.get<Record<string, string>>(LOCAL_PORTAL_WALLET_IDS)) ?? {};
  const cached = ids[accountIndex];
  if (cached) return cached;

  const accounts = await wallet.addressesFor(accountIndex);
  const byChain = new Map<NativeChain, string>(accounts.map((a) => [a.chain, a.address]));

  const addresses = PAY_CHAINS.flatMap((chain) => {
    const signer = signingChain(chain);
    const address = byChain.get(signer);
    if (!address) return [];
    return [{ chain, address, derivation_path: derivationPath(signer, accountIndex) }];
  });

  const authKey = derivePrivateKey(seed, 'ETH', accountIndex);
  const solAddress = byChain.get('SOL');
  try {
    const { wallet_id } = await api.registerWallet({
      publicKeySecp256k1: compressedPublicKey(authKey),
      publicKeyEd25519: solAddress, // Solana addresses ARE base58 ed25519 pubkeys
      addresses,
      privateKey: authKey,
    });
    ids[accountIndex] = wallet_id;
    await local.set(LOCAL_PORTAL_WALLET_IDS, ids);
    return wallet_id;
  } finally {
    authKey.fill(0);
  }
}

/**
 * Drop the pre-multi-account cache. That single id was registered with the
 * ACTIVE account's addresses but account 0's key, so its server-side address
 * set cannot be trusted. Re-registering is idempotent — the portal returns the
 * same wallet id for the same key and backfills the correct addresses.
 */
async function migrateLegacyPortalWallet(): Promise<void> {
  const legacy = await local.get<string>(LOCAL_PORTAL_WALLET_ID);
  if (legacy) await local.remove(LOCAL_PORTAL_WALLET_ID);
}

// ── Site request handling ────────────────────────────────────────────────────

/** Origin of the page that sent a message — from the browser, not the page. */
function senderOrigin(sender: chrome.runtime.MessageSender): string | null {
  return normalizeOrigin(sender.origin ?? sender.url ?? null);
}

async function handleSitePayBatch(
  origin: string,
  rawPayments: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<WalletResponse> {
  if (!(await connections.isConnected(origin))) {
    return { ok: false, error: 'Site is not connected to this wallet' };
  }
  if (!(await wallet.isInitialized())) {
    return { ok: false, error: 'No wallet has been set up yet' };
  }

  const payments = parseBatchRequests(rawPayments, MAX_BATCH_SIZE);
  const requestId = newRequestId();
  const approval: PendingApproval = {
    kind: 'payBatch',
    requestId,
    origin,
    needsUnlock: !(await wallet.isUnlocked()),
    // Pinned at request time: the user approves a specific account paying, so
    // switching accounts while the prompt is open must not repoint the payer.
    accountIndex: await wallet.getActiveAccount(),
    payments,
    summary: summarizeBatch(payments),
  };

  const approved = await requestApproval(approval);
  if (!approved) {
    await clearApproval(requestId);
    return { ok: false, error: 'Payment request rejected' };
  }

  const entry = pending.get(requestId);
  try {
    // Approving requires unlocking, so by here the seed is available.
    const seed = await wallet.requireSeed();
    const { accountIndex } = approval;
    const walletId = await ensurePortalWallet(seed, accountIndex);
    const accounts = await wallet.addressesFor(accountIndex);
    const addresses: Partial<Record<NativeChain, string>> = {};
    for (const account of accounts) addresses[account.chain] = account.address;

    const authKey = derivePrivateKey(seed, 'ETH', accountIndex);
    try {
      const results = await runBatchPayments(payments, {
        api,
        walletId,
        seed,
        authKey,
        accountIndex,
        addresses,
        signal: entry?.abort.signal,
        onProgress: (progress) => {
          // Keep the wallet awake for the duration of a long run.
          scheduleAutoLock();
          const event: WalletEvent = { type: 'coinpay:progress', requestId, origin, progress };
          broadcast(event);
          if (sender.tab?.id !== undefined) {
            chrome.tabs.sendMessage(sender.tab.id, event).catch(() => {});
          }
        },
      });
      await connections.touch(origin);
      return { ok: true, results };
    } finally {
      authKey.fill(0);
    }
  } finally {
    // Leave the window up as the results view; the user dismisses it.
    await clearApproval(requestId, false);
    scheduleAutoLock();
  }
}

/**
 * A send the user initiated inside the extension.
 *
 * No approval window: they are already looking at the popup and confirmed
 * there, so a second prompt would just be a prompt about their own click. It
 * runs through the same executor as a site batch (a batch of one), so nonce
 * handling, retries and the prepare/sign/broadcast split stay in one place.
 */
async function handleSend(chain: string, to: string, amount: string): Promise<BatchItemResult> {
  if (!(await wallet.isInitialized())) throw new Error('No wallet has been set up yet');
  if (!(await wallet.isUnlocked())) throw new Error('Wallet is locked');

  const payChain = toPayChain(chain);
  if (!payChain) throw new Error(`Unsupported chain: ${chain}`);
  const recipient = to.trim();
  if (!recipient) throw new Error('Recipient address is required');
  if (!/^\d+(\.\d+)?$/.test(amount.trim()) || Number(amount) <= 0) {
    throw new Error('Amount must be a positive number');
  }

  const seed = await wallet.requireSeed();
  // Everything below must agree on ONE account: the addresses we send from, the
  // portal wallet those addresses are registered under, the auth key, and the
  // signing key.
  const accountIndex = await wallet.getActiveAccount();
  const walletId = await ensurePortalWallet(seed, accountIndex);
  const accounts = await wallet.addressesFor(accountIndex);
  const addresses: Partial<Record<NativeChain, string>> = {};
  for (const account of accounts) addresses[account.chain] = account.address;

  const authKey = derivePrivateKey(seed, 'ETH', accountIndex);
  try {
    const [result] = await runBatchPayments(
      [{ id: `popup-${Date.now()}`, chain: payChain, to: recipient, amount: amount.trim() }],
      { api, walletId, seed, authKey, accountIndex, addresses },
    );
    if (!result) throw new Error('Send produced no result');
    if (result.status === 'failed') throw new Error(result.error || 'Send failed');
    return result;
  } finally {
    authKey.fill(0);
  }
}

async function handleSiteConnect(origin: string): Promise<WalletResponse> {
  if (await connections.isConnected(origin)) {
    await connections.touch(origin);
    return { ok: true, accounts: await wallet.getAccounts() };
  }
  if (!(await wallet.isInitialized())) {
    return { ok: false, error: 'No wallet has been set up yet' };
  }

  const requestId = newRequestId();
  const approved = await requestApproval({
    kind: 'connect',
    requestId,
    origin,
    needsUnlock: !(await wallet.isUnlocked()),
  });
  await clearApproval(requestId);

  if (!approved) return { ok: false, error: 'Connection rejected' };
  await connections.connect(origin);
  return { ok: true, accounts: await wallet.getAccounts() };
}

// ── Approval-window handling ─────────────────────────────────────────────────

async function handleApprovalApprove(
  requestId: string,
  password?: string,
): Promise<WalletResponse> {
  const approval = await readApproval(requestId);
  if (!approval) return { ok: false, error: 'This request is no longer pending' };

  if (!(await wallet.isUnlocked())) {
    if (!password) return { ok: false, error: 'Password required' };
    await wallet.unlock(password); // throws on a wrong password
    scheduleAutoLock();
  }

  settleApproval(requestId, true);
  return { ok: true };
}

// ── Router ───────────────────────────────────────────────────────────────────

async function handle(
  req: WalletRequest,
  sender: chrome.runtime.MessageSender,
): Promise<WalletResponse> {
  try {
    switch (req.type) {
      case 'getState':
        return {
          ok: true,
          state: { initialized: await wallet.isInitialized(), unlocked: await wallet.isUnlocked() },
        };
      case 'beginCreate': {
        const { mnemonic, accounts } = await wallet.beginCreate(req.words ?? 12);
        return { ok: true, mnemonic, accounts };
      }
      case 'confirmCreate': {
        const accounts = await wallet.confirmCreate(req.password);
        scheduleAutoLock();
        return { ok: true, accounts };
      }
      case 'cancelCreate':
        await wallet.cancelCreate();
        return {
          ok: true,
          state: { initialized: await wallet.isInitialized(), unlocked: await wallet.isUnlocked() },
        };
      case 'import': {
        const accounts = await wallet.import(req.mnemonic, req.password);
        // A different seed means a different portal wallet; drop the cached id.
        await local.remove(LOCAL_PORTAL_WALLET_ID);
        scheduleAutoLock();
        return { ok: true, accounts };
      }
      case 'unlock': {
        const accounts = await wallet.unlock(req.password);
        scheduleAutoLock();
        return { ok: true, accounts };
      }
      case 'lock':
        await wallet.lock();
        return { ok: true, state: { initialized: await wallet.isInitialized(), unlocked: false } };
      case 'getAccounts':
        return { ok: true, accounts: await wallet.getAccounts() };

      // ── accounts: one seed, many BIP-44 indexes ──
      case 'listAccounts':
        return {
          ok: true,
          walletAccounts: await wallet.listAccounts(),
          activeAccount: await wallet.getActiveAccount(),
        };
      case 'addAccount': {
        await wallet.addAccount(req.label);
        scheduleAutoLock();
        return {
          ok: true,
          walletAccounts: await wallet.listAccounts(),
          activeAccount: await wallet.getActiveAccount(),
        };
      }
      case 'selectAccount': {
        await wallet.selectAccount(req.index);
        return { ok: true, accounts: await wallet.getAccounts() };
      }
      case 'renameAccount': {
        const walletAccounts = await wallet.renameAccount(req.index, req.label);
        return { ok: true, walletAccounts, activeAccount: await wallet.getActiveAccount() };
      }
      case 'removeAccount': {
        const { accounts, activeAccount } = await wallet.removeAccount(req.index);
        // The account can no longer pay, so its portal registration is dead
        // local state. The index is retired, so nothing can inherit this entry.
        const ids = (await local.get<Record<string, string>>(LOCAL_PORTAL_WALLET_IDS)) ?? {};
        if (ids[req.index]) {
          delete ids[req.index];
          await local.set(LOCAL_PORTAL_WALLET_IDS, ids);
        }
        return { ok: true, walletAccounts: accounts, activeAccount };
      }

      // ── user-initiated send (the popup's own payment, not a site's) ──
      case 'send': {
        const sent = await handleSend(req.chain, req.to, req.amount);
        scheduleAutoLock();
        return { ok: true, sent };
      }

      case 'getSettings':
        return {
          ok: true,
          settings: { autoLockMinutes: await autoLockMinutes(), fiatCurrency: await fiatCurrency() },
        };
      case 'setAutoLockMinutes': {
        const minutes = Math.min(Math.max(Math.round(req.minutes), 1), 60 * 24);
        await local.set(LOCAL_AUTO_LOCK_MINUTES, minutes);
        scheduleAutoLock(minutes);
        return { ok: true, settings: { autoLockMinutes: minutes, fiatCurrency: await fiatCurrency() } };
      }
      case 'setFiatCurrency': {
        // Coerced rather than rejected: an unsupported code can only come from
        // a stale UI, and USD is a safe, clearly-labelled fallback.
        const currency = toFiatCurrency(req.currency);
        await local.set(LOCAL_FIAT_CURRENCY, currency);
        return {
          ok: true,
          settings: { autoLockMinutes: await autoLockMinutes(), fiatCurrency: currency },
        };
      }
      case 'getRate': {
        // Quoting a price is not wallet activity, so it deliberately does not
        // push back the auto-lock timer.
        const fiat = req.fiat ? toFiatCurrency(req.fiat) : await fiatCurrency();
        return { ok: true, quote: await rates.get(req.coin, fiat) };
      }

      case 'listConnections':
        return { ok: true, connections: await connections.list() };
      case 'disconnectSite':
        await connections.disconnect(req.origin);
        return { ok: true, connections: await connections.list() };

      // ── page-originated ──
      case 'site:getState': {
        const origin = senderOrigin(sender);
        return {
          ok: true,
          siteState: {
            initialized: await wallet.isInitialized(),
            unlocked: await wallet.isUnlocked(),
            connected: await connections.isConnected(origin),
          },
        };
      }
      case 'site:connect': {
        const origin = senderOrigin(sender);
        if (!origin) return { ok: false, error: 'Unknown origin' };
        return handleSiteConnect(origin);
      }
      case 'site:getAccounts': {
        const origin = senderOrigin(sender);
        if (!(await connections.isConnected(origin))) {
          return { ok: false, error: 'Site is not connected to this wallet' };
        }
        return { ok: true, accounts: await wallet.getAccounts() };
      }
      case 'site:payBatch': {
        const origin = senderOrigin(sender);
        if (!origin) return { ok: false, error: 'Unknown origin' };
        return handleSitePayBatch(origin, req.payments, sender);
      }

      // ── approval window ──
      case 'approval:get': {
        const approval = await readApproval(req.requestId);
        if (!approval) return { ok: false, error: 'This request is no longer pending' };
        return { ok: true, approval };
      }
      case 'approval:approve':
        return handleApprovalApprove(req.requestId, req.password);
      case 'approval:reject':
        settleApproval(req.requestId, false);
        return { ok: true };
      case 'approval:cancel': {
        // Stop after the payment currently in flight; sent ones stay sent.
        pending.get(req.requestId)?.abort.abort();
        return { ok: true };
      }
      default:
        return { ok: false, error: 'Unknown request' };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

chrome.runtime.onMessage.addListener((req: WalletRequest, sender, sendResponse) => {
  // Events we broadcast to extension pages come back through this listener too;
  // ignore anything that isn't a request.
  if (!req || typeof req.type !== 'string' || req.type.startsWith('coinpay:')) return;
  handle(req, sender).then(sendResponse);
  return true; // keep the message channel open for the async response
});
