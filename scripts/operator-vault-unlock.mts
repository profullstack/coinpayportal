#!/usr/bin/env npx tsx
/**
 * Unlock (or lock) CoinPay's operator keys from a terminal.
 *
 *   COINPAY_URL=https://coinpayportal.com COINPAY_ADMIN_TOKEN=<admin JWT> \
 *     npx tsx scripts/operator-vault-unlock.mts [--hours 168] [--recovery] [--lock] [--status]
 *
 * The passphrase (or recovery key) is read from the terminal without echo and
 * never leaves this machine: the data key is derived here (PBKDF2 600k + HKDF)
 * and only that is sent, over TLS, to /api/admin/operator-vault/unlock.
 */
import { createInterface } from 'node:readline';
import { bytesToBase64, unwrapDek, unwrapDekWithRecovery, wipe, type VaultRecord } from '../src/lib/vault/sealed-vault';

const base = (process.env.COINPAY_URL || 'https://coinpayportal.com').replace(/\/$/, '');
const token = process.env.COINPAY_ADMIN_TOKEN;
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const hoursIdx = args.indexOf('--hours');
const hours = hoursIdx >= 0 ? Number(args[hoursIdx + 1]) : 168;

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${path}: HTTP ${res.status}`);
  return body;
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => {
      if (s.includes(prompt)) out.output.write(prompt);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  if (!token) throw new Error('Set COINPAY_ADMIN_TOKEN (an admin session JWT)');
  if (flag('--lock')) {
    await api('/api/admin/operator-vault/lock', { method: 'POST', body: '{}' });
    console.log('locked');
    return;
  }
  const status = await api('/api/admin/operator-vault');
  if (flag('--status')) {
    const { record: _r, ...rest } = status;
    void _r;
    console.log(JSON.stringify(rest, null, 2));
    return;
  }
  if (!status.exists) throw new Error('No operator vault yet: set it up at /admin/operator-vault');
  const record = status.record as VaultRecord;
  const secret = await askHidden(flag('--recovery') ? 'Recovery key: ' : 'Operator passphrase: ');
  const dek = flag('--recovery')
    ? await unwrapDekWithRecovery(record, secret, 'operator', status.subject_id)
    : await unwrapDek(record, secret, 'operator', status.subject_id);
  try {
    const out = await api('/api/admin/operator-vault/unlock', {
      method: 'POST',
      body: JSON.stringify({ data_key: bytesToBase64(dek), ttl_hours: hours }),
    });
    console.log(`unlocked until ${out.expiresAt} (${out.names?.length ?? 0} mnemonics)`);
  } finally {
    wipe(dek);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
