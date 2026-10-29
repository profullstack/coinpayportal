import { PublicKey } from '@solana/web3.js';

/**
 * SPL token balance of an owner address, for payment detection (USDC_SOL,
 * USDT_SOL).
 *
 * Both monitors used `getTokenAccountsByOwner`, which the public mainnet RPC
 * rate-limits per method far below everything else ("Too many requests for a
 * specific RPC call"). With a monitor cycle checking every pending address at
 * once, effectively every lookup 429'd: 0 of 71 USDC_SOL payments ever settled
 * and the logs show the same 429 on each cycle. A paid USDC_SOL checkout would
 * have expired undetected.
 *
 * Wallets send SPL tokens to the owner's associated token account, so derive
 * it and ask `getTokenAccountBalance` for that one account. A missing account
 * means nothing was ever sent (balance 0). A 429 is retried with backoff.
 */

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export function associatedTokenAddress(owner: string, mint: string): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), new PublicKey(mint).toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata.toBase58();
}

export interface SplBalanceOptions {
  fetchImpl?: typeof fetch;
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Returns the balance in whole tokens. Throws when the balance cannot be
 * determined (so a caller never mistakes "RPC failed" for "unpaid").
 */
export async function getSplTokenBalance(
  owner: string,
  rpcUrl: string,
  mint: string,
  decimals: number,
  options: SplBalanceOptions = {}
): Promise<number> {
  const doFetch = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 4;
  const baseDelay = options.baseDelayMs ?? 500;
  const ata = associatedTokenAddress(owner, mint);

  let lastError = 'unknown';
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(baseDelay * 2 ** (attempt - 1) + Math.floor(Math.random() * baseDelay));

    let response: Response;
    try {
      response = await doFetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountBalance', params: [ata] }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      continue;
    }

    let data: any = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    const rateLimited = response.status === 429 || data?.error?.code === 429;
    if (rateLimited || response.status >= 500) {
      lastError = `HTTP ${response.status}`;
      continue;
    }
    if (data?.error) {
      // The ATA does not exist: nothing has ever been sent to this owner.
      if (data.error.code === -32602 && /could not find account/i.test(String(data.error.message))) return 0;
      throw new Error(`SPL balance RPC error: ${String(data.error.message ?? data.error.code).slice(0, 120)}`);
    }
    if (!response.ok) throw new Error(`SPL balance HTTP ${response.status}`);

    const value = data?.result?.value;
    if (!value || typeof value.amount !== 'string') throw new Error('Invalid token balance response');
    if (typeof value.decimals === 'number' && value.decimals !== decimals) throw new Error('Unexpected token decimals');
    const raw = Number(value.amount);
    if (!Number.isFinite(raw) || raw < 0) throw new Error('Invalid token amount');
    return raw / 10 ** decimals;
  }
  throw new Error(`SPL balance lookup failed after retries: ${lastError}`);
}
