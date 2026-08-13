/**
 * Business taxonomy and risk classification.
 *
 * Every business gets one `category` from the list below plus free-form `tags`
 * (keywords like "streaming", "iptv"). Category and tags together drive a
 * derived `risk_level` so onboarding can route the risky ones to review
 * instead of discovering the problem after the first chargeback.
 *
 * The taxonomy lives in code rather than a table so it can be versioned with
 * the rules that read it. There is deliberately no DB check constraint on
 * `category` — validation happens here.
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'prohibited';

export const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high', 'prohibited'];

export interface BusinessCategory {
  slug: string;
  label: string;
  group: string;
  /** Floor risk for anything in this category, before keyword rules apply. */
  baseRisk: RiskLevel;
  /** Keywords that suggest this category and double as tag autocomplete. */
  keywords: string[];
}

export const CATEGORY_GROUPS = [
  'Digital & Media',
  'Commerce',
  'Services',
  'Finance & Crypto',
  'Restricted',
  'Other',
] as const;

export const BUSINESS_CATEGORIES: BusinessCategory[] = [
  // ---------------------------------------------------------------- Digital
  {
    slug: 'streaming-iptv',
    label: 'Streaming / IPTV',
    group: 'Digital & Media',
    baseRisk: 'high',
    keywords: [
      'streaming', 'iptv', 'vod', 'restream', 'live tv', 'm3u', 'xtream',
      'cccam', 'firestick', 'ppv', 'pay per view', 'sports streaming',
    ],
  },
  {
    slug: 'digital-goods',
    label: 'Digital Goods & Downloads',
    group: 'Digital & Media',
    baseRisk: 'medium',
    keywords: [
      'digital goods', 'download', 'ebook', 'license key', 'template',
      'preset', 'stock photo', 'font', 'plugin', 'theme',
    ],
  },
  {
    slug: 'saas',
    label: 'SaaS & Software',
    group: 'Digital & Media',
    baseRisk: 'low',
    keywords: ['saas', 'software', 'api', 'platform', 'web app', 'b2b software'],
  },
  {
    slug: 'hosting-infrastructure',
    label: 'Hosting & Infrastructure',
    group: 'Digital & Media',
    baseRisk: 'medium',
    keywords: [
      'hosting', 'vps', 'vpn', 'proxy', 'domain', 'dedicated server', 'cdn',
      'rdp', 'colocation',
    ],
  },
  {
    slug: 'gaming',
    label: 'Gaming & Virtual Goods',
    group: 'Digital & Media',
    baseRisk: 'medium',
    keywords: [
      'gaming', 'game key', 'in game', 'skins', 'game currency', 'top up',
      'boosting', 'steam',
    ],
  },
  {
    slug: 'nft-collectibles',
    label: 'NFTs & Digital Collectibles',
    group: 'Digital & Media',
    baseRisk: 'high',
    keywords: ['nft', 'mint', 'collectible', 'pfp', 'digital art drop'],
  },
  {
    slug: 'media-publishing',
    label: 'Media & Publishing',
    group: 'Digital & Media',
    baseRisk: 'low',
    keywords: ['blog', 'news', 'magazine', 'podcast', 'newsletter', 'publisher'],
  },

  // --------------------------------------------------------------- Commerce
  {
    slug: 'ecommerce-retail',
    label: 'E-commerce & Retail',
    group: 'Commerce',
    baseRisk: 'low',
    keywords: ['ecommerce', 'retail', 'shop', 'store', 'apparel', 'clothing', 'merch'],
  },
  {
    slug: 'marketplace',
    label: 'Marketplace / Multi-vendor',
    group: 'Commerce',
    baseRisk: 'medium',
    keywords: ['marketplace', 'multi vendor', 'classifieds', 'peer to peer', 'sellers'],
  },
  {
    slug: 'dropshipping',
    label: 'Dropshipping',
    group: 'Commerce',
    baseRisk: 'medium',
    keywords: ['dropshipping', 'dropship', 'print on demand', 'aliexpress'],
  },
  {
    slug: 'food-beverage',
    label: 'Food & Beverage',
    group: 'Commerce',
    baseRisk: 'low',
    keywords: ['restaurant', 'cafe', 'food', 'catering', 'bakery', 'coffee', 'food delivery'],
  },
  {
    slug: 'electronics-hardware',
    label: 'Electronics & Hardware',
    group: 'Commerce',
    baseRisk: 'medium',
    keywords: ['electronics', 'hardware', 'laptop', 'gpu', 'asic', 'mining rig', 'phones'],
  },
  {
    slug: 'manufacturing-wholesale',
    label: 'Manufacturing & Wholesale',
    group: 'Commerce',
    baseRisk: 'low',
    keywords: ['manufacturing', 'wholesale', 'factory', 'oem', 'bulk supply'],
  },

  // --------------------------------------------------------------- Services
  {
    slug: 'professional-services',
    label: 'Professional Services',
    group: 'Services',
    baseRisk: 'low',
    keywords: ['consulting', 'consultant', 'accounting', 'bookkeeping', 'legal', 'advisory'],
  },
  {
    slug: 'creative-marketing',
    label: 'Creative & Marketing Agency',
    group: 'Services',
    baseRisk: 'low',
    keywords: ['agency', 'marketing', 'seo', 'branding', 'design studio', 'social media'],
  },
  {
    slug: 'dev-it-services',
    label: 'Development & IT Services',
    group: 'Services',
    baseRisk: 'low',
    keywords: ['web development', 'developer', 'it services', 'devops', 'web design'],
  },
  {
    slug: 'freelance',
    label: 'Freelance / Contract Work',
    group: 'Services',
    baseRisk: 'low',
    keywords: ['freelance', 'contractor', 'gig', 'hourly work'],
  },
  {
    slug: 'education',
    label: 'Education & Courses',
    group: 'Services',
    baseRisk: 'low',
    keywords: ['course', 'training', 'tutoring', 'bootcamp', 'coaching', 'academy', 'elearning'],
  },
  {
    slug: 'events-ticketing',
    label: 'Events & Ticketing',
    group: 'Services',
    baseRisk: 'medium',
    keywords: ['event', 'ticket', 'conference', 'festival', 'venue', 'concert'],
  },
  {
    slug: 'travel-hospitality',
    label: 'Travel & Hospitality',
    group: 'Services',
    baseRisk: 'medium',
    keywords: ['travel', 'flight', 'hotel', 'tour', 'vacation', 'booking'],
  },
  {
    slug: 'real-estate',
    label: 'Real Estate & Rentals',
    group: 'Services',
    baseRisk: 'medium',
    keywords: ['real estate', 'rental', 'property', 'lease', 'landlord'],
  },
  {
    slug: 'logistics',
    label: 'Logistics & Shipping',
    group: 'Services',
    baseRisk: 'low',
    keywords: ['shipping', 'freight', 'courier', 'logistics', 'fulfillment', 'warehouse'],
  },
  {
    slug: 'health-wellness',
    label: 'Health & Wellness',
    group: 'Services',
    baseRisk: 'medium',
    keywords: ['clinic', 'therapy', 'telehealth', 'fitness', 'gym', 'wellness', 'spa', 'massage'],
  },
  {
    slug: 'nonprofit',
    label: 'Nonprofit & Fundraising',
    group: 'Services',
    baseRisk: 'medium',
    keywords: ['charity', 'nonprofit', 'donation', 'fundraiser', 'ngo', 'crowdfunding'],
  },

  // -------------------------------------------------------- Finance & Crypto
  {
    slug: 'crypto-exchange',
    label: 'Crypto Exchange / Swap',
    group: 'Finance & Crypto',
    baseRisk: 'high',
    keywords: ['exchange', 'swap', 'otc', 'on ramp', 'off ramp', 'fiat ramp', 'crypto trading'],
  },
  {
    slug: 'crypto-services',
    label: 'Crypto Services & Tooling',
    group: 'Finance & Crypto',
    baseRisk: 'high',
    keywords: ['wallet', 'staking', 'validator', 'node', 'defi', 'bridge', 'custody'],
  },
  {
    slug: 'payments-fintech',
    label: 'Payments & Fintech',
    group: 'Finance & Crypto',
    baseRisk: 'high',
    keywords: ['payments', 'remittance', 'money transfer', 'payout', 'fintech', 'prepaid card'],
  },
  {
    slug: 'lending-credit',
    label: 'Lending & Credit',
    group: 'Finance & Crypto',
    baseRisk: 'high',
    keywords: ['loan', 'lending', 'credit', 'borrow', 'mortgage', 'buy now pay later'],
  },
  {
    slug: 'investment-trading',
    label: 'Investment & Trading',
    group: 'Finance & Crypto',
    baseRisk: 'high',
    keywords: ['investment', 'fund', 'portfolio', 'trading signals', 'trading bot', 'forex', 'copy trading'],
  },
  {
    slug: 'insurance',
    label: 'Insurance',
    group: 'Finance & Crypto',
    baseRisk: 'medium',
    keywords: ['insurance', 'underwriting', 'policy', 'claims'],
  },

  // ------------------------------------------------------------- Restricted
  {
    slug: 'gambling',
    label: 'Gambling, Casino & Betting',
    group: 'Restricted',
    baseRisk: 'prohibited',
    keywords: ['casino', 'betting', 'gambling', 'poker', 'lottery', 'sportsbook', 'wager', 'slots'],
  },
  {
    slug: 'adult',
    label: 'Adult Content',
    group: 'Restricted',
    baseRisk: 'high',
    keywords: ['adult', 'nsfw', 'cam site', 'fetish', 'escort'],
  },
  {
    slug: 'cannabis-vape',
    label: 'Cannabis, CBD & Vape',
    group: 'Restricted',
    baseRisk: 'high',
    keywords: ['cannabis', 'cbd', 'thc', 'hemp', 'vape', 'kratom', 'nicotine', 'tobacco'],
  },
  {
    slug: 'pharmacy',
    label: 'Pharmacy & Prescription',
    group: 'Restricted',
    baseRisk: 'high',
    keywords: ['pharmacy', 'prescription', 'medication', 'peptide', 'sarms', 'steroid'],
  },
  {
    slug: 'supplements',
    label: 'Supplements & Nutraceuticals',
    group: 'Restricted',
    baseRisk: 'medium',
    keywords: ['supplement', 'vitamin', 'nootropic', 'protein powder', 'weight loss'],
  },
  {
    slug: 'firearms',
    label: 'Firearms, Weapons & Ammo',
    group: 'Restricted',
    baseRisk: 'prohibited',
    keywords: ['firearm', 'gun', 'ammo', 'ammunition', 'rifle', 'weapon', 'silencer'],
  },

  // ------------------------------------------------------------------ Other
  {
    slug: 'other',
    label: 'Other',
    group: 'Other',
    baseRisk: 'medium',
    keywords: [],
  },
];

export const CATEGORY_SLUGS = BUSINESS_CATEGORIES.map((c) => c.slug);

const CATEGORY_BY_SLUG = new Map(BUSINESS_CATEGORIES.map((c) => [c.slug, c]));

export function getCategory(slug: string | null | undefined): BusinessCategory | undefined {
  return slug ? CATEGORY_BY_SLUG.get(slug) : undefined;
}

export function isValidCategory(slug: unknown): slug is string {
  return typeof slug === 'string' && CATEGORY_BY_SLUG.has(slug);
}

/**
 * Keyword rules that apply regardless of the category the merchant picked.
 * These exist because the category is self-declared — a merchant selling IPTV
 * subscriptions will happily file themselves under "SaaS".
 */
export interface KeywordRule {
  code: string;
  label: string;
  severity: RiskLevel;
  keywords: string[];
}

export const KEYWORD_RULES: KeywordRule[] = [
  {
    code: 'fraud-instruments',
    label: 'Stolen card / account data',
    severity: 'prohibited',
    keywords: ['carding', 'cvv', 'fullz', 'dumps', 'stolen card', 'stolen account', 'cracked account', 'bin lookup'],
  },
  {
    code: 'money-laundering',
    label: 'Mixing / laundering',
    severity: 'prohibited',
    keywords: ['mixer', 'tumbler', 'coin mixer', 'money laundering', 'launder', 'clean coins', 'wash trading'],
  },
  {
    code: 'counterfeit',
    label: 'Counterfeit or forged goods',
    severity: 'prohibited',
    keywords: ['counterfeit', 'replica watch', 'fake id', 'fake passport', 'forged document', 'knockoff'],
  },
  {
    code: 'darknet',
    label: 'Darknet marketplace',
    severity: 'prohibited',
    keywords: ['darknet', 'dark web', 'onion market', 'hidden service market'],
  },
  {
    code: 'controlled-substances',
    label: 'Controlled substances',
    severity: 'prohibited',
    keywords: ['cocaine', 'heroin', 'methamphetamine', 'mdma', 'research chemical', 'street drugs'],
  },
  {
    code: 'csae',
    label: 'Child sexual abuse material',
    severity: 'prohibited',
    keywords: ['csam', 'child porn', 'underage porn', 'jailbait', 'loli'],
  },
  {
    code: 'violence-for-hire',
    label: 'Violence for hire',
    severity: 'prohibited',
    keywords: ['hitman', 'assassination', 'contract killing'],
  },
  {
    code: 'cybercrime',
    label: 'Attack tooling / cybercrime',
    severity: 'prohibited',
    keywords: ['ddos', 'booter', 'stresser', 'botnet', 'ransomware', 'malware', 'phishing kit', 'otp bot', 'spam service'],
  },
  {
    code: 'ponzi',
    label: 'Guaranteed-return scheme',
    severity: 'prohibited',
    keywords: ['ponzi', 'hyip', 'pyramid scheme', 'matrix scheme', 'money doubler', 'guaranteed returns', 'guaranteed roi'],
  },
  {
    code: 'piracy',
    label: 'Unlicensed content resale',
    severity: 'high',
    keywords: [
      'iptv', 'restream', 'cracked software', 'nulled', 'warez', 'keygen',
      'netflix account', 'account sharing', 'premium account resale', 'pirated',
    ],
  },
  {
    code: 'kyc-evasion',
    label: 'KYC / traceability evasion',
    severity: 'high',
    keywords: ['no kyc', 'bypass kyc', 'anonymous payments', 'untraceable', 'privacy coin only'],
  },
  {
    code: 'gambling',
    label: 'Gambling and betting',
    severity: 'high',
    keywords: ['casino', 'sportsbook', 'betting site', 'online gambling', 'slots', 'wager', 'lottery'],
  },
  {
    code: 'adult',
    label: 'Adult content',
    severity: 'high',
    keywords: ['porn', 'xxx', 'escort service', 'cam girl', 'onlyfans'],
  },
  {
    code: 'stored-value',
    label: 'Gift cards and stored value',
    severity: 'high',
    keywords: ['gift card', 'prepaid card', 'voucher resale', 'e-gift'],
  },
  {
    code: 'ticket-resale',
    label: 'Ticket resale',
    severity: 'medium',
    keywords: ['ticket resale', 'scalping', 'secondary tickets'],
  },
];

export interface RiskFlag {
  code: string;
  label: string;
  severity: RiskLevel;
  /** Which keywords actually matched, so a reviewer can see the evidence. */
  matched: string[];
  source: 'category' | 'keyword';
}

export interface Classification {
  category: string | null;
  tags: string[];
  riskLevel: RiskLevel;
  /** True when a human should look before the business goes live. */
  reviewRequired: boolean;
  flags: RiskFlag[];
}

export interface ClassifyInput {
  name?: string | null;
  description?: string | null;
  category?: string | null;
  tags?: string[] | null;
}

/** Lowercase, strip punctuation, collapse whitespace. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const KEYWORD_PATTERNS = new Map<string, RegExp>();

function patternFor(keyword: string): RegExp {
  let pattern = KEYWORD_PATTERNS.get(keyword);
  if (!pattern) {
    const escaped = normalize(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Allow a plural on the last word: "casinos" matches "casino".
    pattern = new RegExp(`\\b${escaped.replace(/ /g, '\\s+')}(?:s|es)?\\b`);
    KEYWORD_PATTERNS.set(keyword, pattern);
  }
  return pattern;
}

function matchKeywords(haystack: string, keywords: string[]): string[] {
  return keywords.filter((keyword) => patternFor(keyword).test(haystack));
}

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 32;

/**
 * Clean up merchant-entered keywords: lowercase, drop the leading '#', collapse
 * whitespace, dedupe, and cap length and count.
 */
export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const tag = raw
      .toLowerCase()
      .replace(/^#+/, '')
      .replace(/[^a-z0-9+&.\- ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TAG_LENGTH);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * Derive a risk level from the declared category plus keyword rules run over
 * the name, description and tags.
 */
export function classifyBusiness(input: ClassifyInput): Classification {
  const tags = normalizeTags(input.tags ?? []);
  const category = isValidCategory(input.category) ? input.category : null;
  const categoryDef = getCategory(category);

  const haystack = normalize(
    [input.name ?? '', input.description ?? '', tags.join(' '), categoryDef?.label ?? ''].join(' ')
  );

  const flags: RiskFlag[] = [];
  let riskLevel: RiskLevel = 'low';

  if (categoryDef && categoryDef.baseRisk !== 'low') {
    riskLevel = maxRisk(riskLevel, categoryDef.baseRisk);
    flags.push({
      code: `category:${categoryDef.slug}`,
      label: categoryDef.label,
      severity: categoryDef.baseRisk,
      matched: [],
      source: 'category',
    });
  }

  // No category at all is itself a reason to look twice.
  if (!categoryDef) {
    riskLevel = maxRisk(riskLevel, 'medium');
    flags.push({
      code: 'category:missing',
      label: 'No category selected',
      severity: 'medium',
      matched: [],
      source: 'category',
    });
  }

  for (const rule of KEYWORD_RULES) {
    const matched = matchKeywords(haystack, rule.keywords);
    if (matched.length === 0) continue;
    riskLevel = maxRisk(riskLevel, rule.severity);
    flags.push({
      code: rule.code,
      label: rule.label,
      severity: rule.severity,
      matched,
      source: 'keyword',
    });
  }

  // Keep the worst flags first so a reviewer reads the reason for the level.
  flags.sort((a, b) => RISK_ORDER.indexOf(b.severity) - RISK_ORDER.indexOf(a.severity));

  return {
    category,
    tags,
    riskLevel,
    reviewRequired: riskLevel === 'high' || riskLevel === 'prohibited',
    flags,
  };
}

export interface CategorySuggestion {
  slug: string;
  label: string;
  score: number;
  matched: string[];
}

/**
 * Rank categories against free text, for the "we think this is X" hint on the
 * create form. Never returns 'other'.
 */
export function suggestCategories(text: string, limit = 3): CategorySuggestion[] {
  const haystack = normalize(text || '');
  if (!haystack) return [];

  return BUSINESS_CATEGORIES.filter((c) => c.keywords.length > 0)
    .map((c) => {
      const matched = matchKeywords(haystack, c.keywords);
      return { slug: c.slug, label: c.label, score: matched.length, matched };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, limit);
}

/**
 * Tag autocomplete: every keyword in the taxonomy, optionally filtered by a
 * prefix the merchant is typing and biased toward the selected category.
 */
export function suggestTags(query: string, category?: string | null, limit = 8): string[] {
  const q = normalize(query || '');
  const preferred = getCategory(category)?.keywords ?? [];
  const rest = BUSINESS_CATEGORIES.flatMap((c) => (c.slug === category ? [] : c.keywords));

  const seen = new Set<string>();
  const out: string[] = [];
  for (const keyword of [...preferred, ...rest]) {
    if (seen.has(keyword)) continue;
    if (q && !normalize(keyword).includes(q)) continue;
    seen.add(keyword);
    out.push(keyword);
    if (out.length >= limit) break;
  }
  return out;
}
