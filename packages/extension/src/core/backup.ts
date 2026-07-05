/**
 * Seed-backup confirmation helpers (PRD P0-2: "Seed backup screen requires
 * confirmation before wallet is usable").
 *
 * Pure functions so the confirmation UX is unit-testable without a DOM.
 */

export type Rand = () => number;

/** Pick `n` distinct indices in [0, total), sorted ascending. */
export function pickIndices(total: number, n: number, rand: Rand = Math.random): number[] {
  if (n > total) throw new Error('n cannot exceed total');
  const chosen = new Set<number>();
  while (chosen.size < n) {
    chosen.add(Math.floor(rand() * total));
  }
  return [...chosen].sort((a, b) => a - b);
}

/**
 * Build a shuffled multiple-choice set for confirming the word at `index`:
 * the correct word plus `decoys` distinct words drawn from `wordlist`.
 */
export function makeChoices(
  mnemonicWords: string[],
  index: number,
  wordlist: readonly string[],
  decoys = 2,
  rand: Rand = Math.random,
): string[] {
  const correct = mnemonicWords[index];
  if (correct === undefined) throw new Error(`No word at index ${index}`);
  const options = new Set<string>([correct]);
  let guard = 0;
  while (options.size < decoys + 1 && guard++ < 10_000) {
    const candidate = wordlist[Math.floor(rand() * wordlist.length)];
    if (candidate && candidate !== correct) options.add(candidate);
  }
  return shuffle([...options], rand);
}

function shuffle<T>(arr: T[], rand: Rand): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
