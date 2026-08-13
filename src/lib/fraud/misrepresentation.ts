/**
 * Declared-vs-observed category checking.
 *
 * A merchant tells us what they sell once, at signup. What they actually sell
 * shows up afterwards, in the description on every payment they take. When a
 * business filed under "Hosting & Infrastructure" starts running charges
 * labelled "12 month IPTV subscription", the declaration is the thing that's
 * wrong — and that gap is worth more than either signal alone.
 */

import {
  RISK_ORDER,
  classifyBusiness,
  getCategory,
  suggestCategories,
  type RiskLevel,
} from '../business/taxonomy';

export interface MisrepresentationResult {
  /** True when observed activity implies more risk than what was declared. */
  mismatch: boolean;
  declaredCategory: string | null;
  declaredRisk: RiskLevel;
  observedRisk: RiskLevel;
  /** Categories the observed text actually looks like. */
  observedCategories: string[];
  /** Keyword-rule codes that fired on the observed text. */
  observedFlags: string[];
  matchedKeywords: string[];
}

/**
 * Compare a declared category against free text observed on real activity —
 * payment descriptions, line items, invoice memos.
 */
export function detectMisrepresentation(input: {
  declaredCategory?: string | null;
  texts: (string | null | undefined)[];
}): MisrepresentationResult {
  const declared = getCategory(input.declaredCategory);
  const declaredRisk: RiskLevel = declared?.baseRisk ?? 'medium';

  const corpus = input.texts.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);

  if (corpus.length === 0) {
    return {
      mismatch: false,
      declaredCategory: declared?.slug ?? null,
      declaredRisk,
      observedRisk: 'low',
      observedCategories: [],
      observedFlags: [],
      matchedKeywords: [],
    };
  }

  const joined = corpus.join(' . ');

  // Classify the observed text on its own merits, with no category to lean on,
  // so only the keyword rules speak.
  const observed = classifyBusiness({ name: '', description: joined, category: null, tags: [] });

  const observedFlags = observed.flags
    .filter((f) => f.source === 'keyword')
    .map((f) => f.code);
  const matchedKeywords = observed.flags.flatMap((f) => f.matched);

  // classifyBusiness floors an absent category at medium; ignore that here —
  // we only care what the keywords themselves imply.
  const keywordRisk = observed.flags
    .filter((f) => f.source === 'keyword')
    .reduce<RiskLevel>(
      (worst, f) => (RISK_ORDER.indexOf(f.severity) > RISK_ORDER.indexOf(worst) ? f.severity : worst),
      'low'
    );

  // Category suggestions are informational only. They are tuned for a "did you
  // mean?" hint on a form, where a stray match costs nothing — "leather wallet"
  // reads as crypto tooling to them. Only the deliberate keyword rules are
  // allowed to call something a mismatch.
  const observedCategories = suggestCategories(joined, 3);
  const observedRisk = keywordRisk;

  return {
    mismatch: RISK_ORDER.indexOf(observedRisk) > RISK_ORDER.indexOf(declaredRisk),
    declaredCategory: declared?.slug ?? null,
    declaredRisk,
    observedRisk,
    observedCategories: observedCategories.map((c) => c.slug),
    observedFlags,
    matchedKeywords,
  };
}
