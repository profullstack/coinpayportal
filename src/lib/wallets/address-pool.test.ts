import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * While the operator keys are sealed and locked, checkout claims pre-derived
 * addresses (keys already sealed) instead of deriving; an empty pool refuses
 * that coin only. Unlocked or unsealed: derive as before.
 */
const state = vi.hoisted(() => ({ sealed: true, unlocked: false, pool: [] as any[] }));

vi.mock('./operator-keys', async (orig) => ({
  ...(await orig<object>()),
  refreshOperatorState: async () => ({ sealed: state.sealed, unlocked: state.unlocked }),
  sealPaymentAddressKey: async (_a: string, pk: string) => `cpv1.sealed-${pk.length}`,
  operatorAlert: vi.fn(),
}));
vi.mock('./derivation-family', async (orig) => ({
  ...(await orig<object>()),
  acquireFamilyIndex: vi.fn(async () => 42),
}));

const { mintSystemAddress } = await import('./system-wallet');
const { OperatorKeysLockedError } = await import('./operator-keys');

function supabase() {
  return {
    rpc: async (name: string, args: { p_cryptocurrency: string }) => {
      expect(name).toBe('claim_operator_pool_address');
      const i = state.pool.findIndex((r) => r.cryptocurrency === args.p_cryptocurrency && !r.claimed_at);
      if (i < 0) return { data: [], error: null };
      state.pool[i].claimed_at = 'now';
      return { data: [state.pool[i]], error: null };
    },
  } as any;
}

beforeEach(() => {
  state.sealed = true;
  state.unlocked = false;
  state.pool = [
    { id: 'p1', cryptocurrency: 'USDC_SOL', derivation_index: 9, address: 'SoLaddr', derivation_path: "m/44'/501'/9'/0'", key_generation: 2, sealed_private_key: 'cpv1.x' },
  ];
});

describe('minting deposit addresses while locked', () => {
  it('claims from the pool, key already sealed', async () => {
    const m = await mintSystemAddress(supabase(), 'USDC_SOL');
    expect(m).toMatchObject({ address: 'SoLaddr', index: 9, storedKey: 'cpv1.x', fromPool: true, keyGeneration: 2 });
    expect(state.pool[0].claimed_at).toBe('now');
  });

  it('an empty pool refuses that coin with a locked error', async () => {
    await expect(mintSystemAddress(supabase(), 'BTC')).rejects.toBeInstanceOf(OperatorKeysLockedError);
  });

  it('never claims from the pool when not sealed', async () => {
    state.sealed = false;
    const prev = process.env.SYSTEM_MNEMONIC_ETH;
    process.env.SYSTEM_MNEMONIC_ETH = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    try {
      const m = await mintSystemAddress(supabase(), 'ETH');
      expect(m.fromPool).toBe(false);
      expect(m.index).toBe(42);
      expect(state.pool[0].claimed_at).toBeUndefined();
    } finally {
      process.env.SYSTEM_MNEMONIC_ETH = prev;
    }
  });
});
