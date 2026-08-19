/**
 * Deriving what SimpleFIN does not tell us.
 *
 * The protocol has no account-type field and no transaction category, so both
 * are inferred here. Everything in this file is pure so it can be tested
 * against real institution names without touching a bank.
 *
 * The guiding rule for both inferences: prefer `unknown`/`null` over a
 * confident guess. A blank category is visibly missing and gets fixed; a wrong
 * one silently distorts the spend breakdown, and `kind` decides which side of
 * the balance sheet an account lands on.
 */

export type AccountKind =
  | 'checking'
  | 'savings'
  | 'credit'
  | 'loan'
  | 'investment'
  | 'cash'
  | 'unknown';

export const ACCOUNT_KINDS: AccountKind[] = [
  'checking',
  'savings',
  'credit',
  'loan',
  'investment',
  'cash',
  'unknown',
];

/** Kinds whose balance is a debt: shown positive as "owed", summed as a liability. */
const LIABILITY_KINDS = new Set<AccountKind>(['credit', 'loan']);

export function isLiabilityKind(kind: AccountKind): boolean {
  return LIABILITY_KINDS.has(kind);
}

export function isAccountKind(value: unknown): value is AccountKind {
  return typeof value === 'string' && (ACCOUNT_KINDS as string[]).includes(value);
}

/**
 * Ordered because the first match wins and the names overlap: "DCU Cash
 * Rewards" is a credit card despite containing "cash", and "Harbor Cash Visa
 * Signature" is one despite containing both "cash" and "checking"-adjacent
 * words. Card signals are therefore tested before deposit-account signals.
 */
const KIND_PATTERNS: Array<{ kind: AccountKind; pattern: RegExp }> = [
  // Card networks and issuer product names are the strongest signal there is.
  {
    kind: 'credit',
    pattern:
      /\b(visa|mastercard|master card|amex|american express|discover it|discover card|credit card|creditcard|charge card)\b/i,
  },
  {
    kind: 'credit',
    pattern:
      /\b(sapphire|freedom|platinum card|gold card|quicksilver|venture|savor|blue cash|cash rewards|rewards card|apple card|graphite|costco anywhere)\b/i,
  },
  { kind: 'credit', pattern: /\bcredit\b/i },

  { kind: 'loan', pattern: /\b(loan|mortgage|heloc|auto ?loan|student|line of credit|lease)\b/i },

  {
    kind: 'investment',
    pattern: /\b(brokerage|invest(ment)?|ira|roth|401\s?k|403\s?b|hsa|529|portfolio|securities|trading)\b/i,
  },

  { kind: 'checking', pattern: /\b(checking|chequing|draft|share draft|debit)\b/i },
  { kind: 'savings', pattern: /\b(savings|saving|money market|mmkt|certificate|share cert|cd\b|time deposit)\b/i },

  { kind: 'cash', pattern: /\b(cash management|wallet|cash account)\b/i },
];

/**
 * Infer an account kind from its name, institution and balance.
 *
 * The balance is a tiebreaker only. A negative balance is strong evidence of a
 * liability, but an overdrawn checking account is negative too — so it is used
 * to promote `unknown` to `credit`, never to override a name that already
 * said "checking".
 *
 * @param name  the account name as the institution renders it
 * @param orgName  the institution name, checked second ("Apple Card" arrives
 *                 as an org whose accounts are named after their holder)
 * @param balance  current balance, or null when unknown
 */
export function inferAccountKind(
  name: string | null | undefined,
  orgName?: string | null,
  balance?: number | null,
): AccountKind {
  const haystacks = [name ?? '', orgName ?? ''];

  for (const haystack of haystacks) {
    if (!haystack.trim()) continue;
    for (const { kind, pattern } of KIND_PATTERNS) {
      if (pattern.test(haystack)) return kind;
    }
  }

  if (typeof balance === 'number' && balance < 0) return 'credit';

  return 'unknown';
}

/** The kind actually in force: an operator override always beats the guess. */
export function effectiveKind(row: {
  kind?: string | null;
  kind_override?: string | null;
}): AccountKind {
  if (isAccountKind(row.kind_override)) return row.kind_override;
  if (isAccountKind(row.kind)) return row.kind;
  return 'unknown';
}

export type SpendCategory =
  | 'income'
  | 'transfer'
  | 'payment'
  | 'fees'
  | 'groceries'
  | 'dining'
  | 'transport'
  | 'fuel'
  | 'travel'
  | 'shopping'
  | 'utilities'
  | 'software'
  | 'advertising'
  | 'health'
  | 'entertainment'
  | 'insurance'
  | 'taxes'
  | 'cash'
  | 'other';

/**
 * Merchant rules, matched against `payee` only.
 *
 * Worth separating from the description rules because the two fields are not
 * alike. `description` is whatever the institution printed — truncated, full of
 * store numbers and reference codes. `payee` arrives already normalised to a
 * merchant name ("Porkbun.com", "Reddit Inc Ads"), which makes a name match
 * here far higher precision than the same word appearing anywhere in a
 * description. So these run first, and they run against the clean field.
 *
 * Anchored with ^ so "Cigars" matches the merchant named Cigars without also
 * catching a description that merely mentions cigars.
 */
const PAYEE_RULES: Array<{ category: SpendCategory; pattern: RegExp }> = [
  // Ad spend is a business cost that has nothing to do with SaaS tooling;
  // folding it into `software` hid five figures a year in the wrong bucket.
  {
    category: 'advertising',
    pattern:
      /^(reddit\b.*ads?|google ads|facebook|meta platforms|x corp ads|linkedin ads|twitter ads|taboola|outbrain|bing ads|microsoft advertising)/i,
  },

  // Infrastructure, SaaS and developer tooling.
  {
    category: 'software',
    pattern:
      /^(porkbun|namecheap|godaddy|cloudflare|turso|supabase|railway|vercel|netlify|heroku|digitalocean|linode|hetzner|aws|amazon web services|google cloud|github|gitlab|openai|anthropic|moonshot ?ai|deepseek|apollo ?io|hedra|higgsfield|thunder compute|trajectdata|jobcopilot|applyme|saasrow|profullstack|jetbrains|figma|notion|slack|atlassian|twilio|sentry|datadog|stripe|expo\b|fly\.io|render\b|neon\b|planetscale|elevenlabs|replicate|huggingface|perplexity|cursor\b|windsurf)/i,
  },

  { category: 'entertainment', pattern: /^(siriusxm|netflix|spotify|hulu|disney|hbo|patreon|twitch|steam)/i },

  // Remittance and money movement — not spending.
  { category: 'transfer', pattern: /^(worldremit|wise\b|remitly|western union|moneygram|revolut|itc outbound|zelle|venmo|cash app)/i },

  // Card and account mechanics.
  { category: 'payment', pattern: /^(returned payment|statement credit|payment reversal)/i },
  { category: 'income', pattern: /^(credit interest income|interest income|dividend|cashback bonus)/i },

  { category: 'fuel', pattern: /^(great gas|chevron|shell|exxon|mobil|arco|valero|circle k fuel)/i },
  { category: 'groceries', pattern: /^(instacart|7-eleven|trader joe|safeway|costco|whole ?foods|sprouts|grocery outlet)/i },
  { category: 'dining', pattern: /^(mcdonald|starbucks|chipotle|subway\b|panera|peet|doordash|uber ?eats|grubhub|taco bell|in-?n-?out)/i },
  { category: 'utilities', pattern: /^(guadalupe landfill|recology|waste management|pg&?e|comcast|xfinity|at&?t|verizon|t-?mobile)/i },

  // Wine, spirits and tobacco are retail, not dining — they are not a meal.
  { category: 'shopping', pattern: /^(.*wine & spirits|.*cigar|cigars|lifestyles|bevmo|total wine|amazon|target|walmart|best buy|home depot|lowe'?s|ikea|etsy|ebay)/i },
];

function categoryFromPayee(payee: unknown): SpendCategory | null {
  if (typeof payee !== 'string') return null;
  const name = payee.trim();
  if (!name) return null;
  for (const { category, pattern } of PAYEE_RULES) {
    if (pattern.test(name)) return category;
  }
  return null;
}

/**
 * MCC ranges, checked before any text. An institution that supplies an MCC is
 * telling us what the merchant actually is, which beats guessing from a
 * description that has been truncated and mangled by three systems.
 *
 * Ranges rather than a full table: the ISO groupings are contiguous by design,
 * and a partial table of exact codes would silently mis-bucket everything it
 * omitted.
 */
const MCC_RANGES: Array<{ from: number; to: number; category: SpendCategory }> = [
  { from: 3000, to: 3299, category: 'travel' },   // airlines
  { from: 3300, to: 3499, category: 'transport' },// car rental
  { from: 3500, to: 3999, category: 'travel' },   // lodging
  { from: 4111, to: 4131, category: 'transport' },
  { from: 4411, to: 4457, category: 'travel' },
  { from: 4468, to: 4468, category: 'travel' },
  { from: 4511, to: 4511, category: 'travel' },
  { from: 4582, to: 4582, category: 'travel' },
  { from: 4722, to: 4723, category: 'travel' },
  { from: 4784, to: 4784, category: 'transport' },
  { from: 4789, to: 4789, category: 'transport' },
  { from: 4812, to: 4816, category: 'utilities' },
  { from: 4821, to: 4821, category: 'utilities' },
  { from: 4899, to: 4900, category: 'utilities' },
  { from: 5411, to: 5422, category: 'groceries' },
  { from: 5441, to: 5451, category: 'groceries' },
  { from: 5462, to: 5499, category: 'groceries' },
  { from: 5541, to: 5542, category: 'fuel' },
  { from: 5983, to: 5983, category: 'fuel' },
  { from: 5812, to: 5814, category: 'dining' },
  { from: 5912, to: 5912, category: 'health' },
  { from: 5960, to: 5960, category: 'insurance' },
  { from: 6300, to: 6300, category: 'insurance' },
  { from: 6010, to: 6012, category: 'cash' },
  { from: 6051, to: 6051, category: 'cash' },
  { from: 7011, to: 7011, category: 'travel' },
  { from: 7512, to: 7513, category: 'transport' },
  { from: 7523, to: 7523, category: 'transport' },
  { from: 7832, to: 7841, category: 'entertainment' },
  { from: 7911, to: 7999, category: 'entertainment' },
  { from: 8011, to: 8099, category: 'health' },
  { from: 8211, to: 8299, category: 'other' },
  { from: 9211, to: 9311, category: 'taxes' },
  { from: 9399, to: 9399, category: 'taxes' },
  { from: 5734, to: 5734, category: 'software' },
  { from: 7372, to: 7372, category: 'software' },
  { from: 5999, to: 5999, category: 'shopping' },
  { from: 5300, to: 5399, category: 'shopping' },
  { from: 5600, to: 5699, category: 'shopping' },
  { from: 5700, to: 5733, category: 'shopping' },
  { from: 5735, to: 5811, category: 'shopping' },
];

function categoryFromMcc(mcc: unknown): SpendCategory | null {
  const raw = typeof mcc === 'number' ? String(mcc) : typeof mcc === 'string' ? mcc.trim() : '';
  if (!/^\d{3,4}$/.test(raw)) return null;
  const code = Number(raw);
  for (const range of MCC_RANGES) {
    if (code >= range.from && code <= range.to) return range.category;
  }
  return null;
}

/**
 * Text rules, in priority order. Transfers and card payments are matched first:
 * they are the highest-volume rows and the most damaging to miscategorise,
 * because a card payment counted as spending double-counts every purchase it
 * settles.
 */
const TEXT_RULES: Array<{ category: SpendCategory; pattern: RegExp }> = [
  {
    category: 'payment',
    pattern:
      /\b(payment thank you|autopay|auto ?pay|online payment|payment received|card payment|pymt|electronic payment)\b/i,
  },
  {
    category: 'transfer',
    pattern:
      /\b(transfer|xfer|zelle|venmo|cash app|cashapp|paypal transfer|wire|ach (credit|debit)|internal|to share|from share)\b/i,
  },
  {
    category: 'income',
    pattern: /\b(payroll|direct dep|direct deposit|salary|dividend|interest (paid|earned)|refund|reimburse)\b/i,
  },
  {
    category: 'fees',
    pattern: /\b(fee|overdraft|nsf|service charge|late charge|finance charge|annual membership|interest charge)\b/i,
  },
  { category: 'cash', pattern: /\b(atm|cash withdrawal|withdrawal)\b/i },
  {
    category: 'groceries',
    pattern:
      /\b(grocer|safeway|trader joe|whole ?foods|costco|kroger|albertsons|aldi|publix|wegmans|sprouts|food ?4 ?less|market)\b/i,
  },
  {
    category: 'dining',
    pattern:
      /\b(restaurant|cafe|coffee|starbucks|peet|doordash|uber ?eats|grubhub|postmates|pizza|taco|sushi|bar & grill|brewing|bakery|deli)\b/i,
  },
  {
    category: 'fuel',
    pattern: /\b(chevron|shell|exxon|mobil|arco|valero|76 gas|gas station|fuel|bp )\b/i,
  },
  {
    category: 'transport',
    pattern: /\b(uber|lyft|transit|parking|toll|bart|caltrain|metro|dmv|smog)\b/i,
  },
  {
    category: 'travel',
    pattern: /\b(airline|airlines|united air|delta air|southwest|alaska air|hotel|motel|airbnb|expedia|marriott|hilton|hyatt|booking\.com)\b/i,
  },
  {
    category: 'software',
    pattern:
      /\b(aws|amazon web services|google cloud|gcp|digitalocean|railway|vercel|netlify|heroku|github|gitlab|openai|anthropic|cloudflare|namecheap|godaddy|jetbrains|adobe|figma|slack|notion|atlassian|twilio|stripe|supabase|hosting|domain)\b/i,
  },
  {
    category: 'utilities',
    pattern:
      /\b(pg&e|pge|electric|water dept|comcast|xfinity|at&?t|verizon|t-?mobile|spectrum|internet|utility|waste|sewer|gas company)\b/i,
  },
  {
    category: 'entertainment',
    pattern: /\b(netflix|spotify|hulu|disney|hbo|max\.com|youtube|prime video|steam|playstation|xbox|cinema|theatre|theater)\b/i,
  },
  {
    category: 'health',
    pattern: /\b(pharmacy|cvs|walgreens|rite aid|medical|dental|dentist|doctor|clinic|hospital|vision|optometr)\b/i,
  },
  { category: 'insurance', pattern: /\b(insurance|geico|state farm|allstate|progressive|policy premium)\b/i },
  { category: 'taxes', pattern: /\b(irs|franchise tax|tax payment|treasury|ftb)\b/i },
  {
    category: 'shopping',
    pattern: /\b(amazon|amzn|target|walmart|best buy|home depot|lowes|ikea|etsy|ebay|apple\.com|store)\b/i,
  },
];

/**
 * Categorise one transaction.
 *
 * @returns a category, or `null` when nothing matched — deliberately not
 *          `'other'`, so "we could not tell" is distinguishable in the data
 *          from "this genuinely belongs in other".
 */
export function categorizeTransaction(input: {
  description?: string | null;
  payee?: string | null;
  memo?: string | null;
  mcc?: string | number | null;
  amount?: number | null;
}): SpendCategory | null {
  // MCC first when present — it is the institution stating what the merchant
  // is. In practice only about 4% of transactions carry one, so it settles far
  // fewer rows than its priority suggests.
  const fromMcc = categoryFromMcc(input.mcc);
  if (fromMcc) return fromMcc;

  // Then the normalised merchant name, which nearly every row does have.
  const fromPayee = categoryFromPayee(input.payee);
  if (fromPayee) {
    // Same guard as below: only a credit can actually be income.
    if (!(fromPayee === 'income' && typeof input.amount === 'number' && input.amount < 0)) {
      return fromPayee;
    }
  }

  const text = [input.payee, input.description, input.memo]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' ');

  if (!text.trim()) return null;

  for (const { category, pattern } of TEXT_RULES) {
    if (pattern.test(text)) {
      // "Refund" and "interest earned" read as income, but only a credit can
      // actually be income. A debit matching an income word is something else
      // entirely (a fee reversal that failed, a transfer out), so fall through
      // rather than record a negative income row.
      if (category === 'income' && typeof input.amount === 'number' && input.amount < 0) continue;
      return category;
    }
  }

  return null;
}

/** Display label for a category, including the null "uncategorised" case. */
export function categoryLabel(category: string | null | undefined): string {
  if (!category) return 'Uncategorised';
  return category.charAt(0).toUpperCase() + category.slice(1);
}
