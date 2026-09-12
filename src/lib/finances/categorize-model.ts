import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { TAX_CATEGORIES, type TaxCategory } from './tax';

/**
 * Language-model categorisation for the books.
 *
 * Runs only where `ANTHROPIC_API_KEY` is configured, and only over rows the
 * rules and heuristics could not settle. It suggests; it never confirms.
 * Everything it returns lands in the `suggested_*` columns with the model's
 * own confidence, and the review queue is where a person accepts it. The
 * model sees payee, description, memo, the sign and magnitude of the
 * amount, and the account's kind and scope — never balances, never other
 * merchants' data.
 */

const SPEND_CATEGORIES = [
  'income', 'transfer', 'payment', 'fees', 'groceries', 'dining', 'transport', 'fuel', 'travel',
  'shopping', 'utilities', 'software', 'advertising', 'health', 'entertainment', 'insurance', 'taxes', 'cash', 'other',
] as const;

export interface ModelInputRow {
  id: string;
  payee: string | null;
  description: string | null;
  memo: string | null;
  /** Signed decimal string; positive is money in. */
  amount: string;
  currency: string;
  accountName: string;
  accountKind: string;
  accountScope: string;
}

export interface ModelSuggestion {
  id: string;
  category: (typeof SPEND_CATEGORIES)[number];
  taxCategory: TaxCategory;
  scope: 'business' | 'personal';
  confidence: number;
  reason: string;
}

export function isModelCategorizationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim()) && env.FINANCES_MODEL_CATEGORIZATION !== 'false';
}

const MODEL = process.env.FINANCES_CATEGORIZATION_MODEL || 'claude-opus-5';
const BATCH = 40;

const SYSTEM = `You are a bookkeeper's assistant categorising bank and card transactions for a small US business owner who also has personal accounts.

For every transaction you are given, return the spend category, the tax category (a Schedule C style bucket used for bookkeeping only, not tax advice), whether it belongs to the business or personal books, a confidence from 0 to 1, and a reason of at most twelve words.

Rules:
- A transfer between the owner's own accounts, a credit-card payment, or a loan payment is category "transfer"/"payment" and tax category "transfer".
- Estimated tax payments to the IRS or a state are "income_tax_payment".
- Money into a business account from customers or platforms is "income_gross_receipts". Refunds and interest are "income_other".
- Meals are "meals"; software, SaaS, domains, hosting and cloud are "software_subscriptions"; ads on Google, Meta, Reddit, X, LinkedIn are "advertising"; bank, Stripe, PayPal, Coinbase fees are "bank_fees".
- Anything that is clearly a personal purchase is "personal" regardless of which account paid for it.
- When you cannot tell, use "uncategorized" with a low confidence rather than guessing.
- Confidence above 0.9 only when the merchant name alone makes the answer certain.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          category: { type: 'string', enum: [...SPEND_CATEGORIES] },
          tax_category: { type: 'string', enum: [...TAX_CATEGORIES] },
          scope: { type: 'string', enum: ['business', 'personal'] },
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['id', 'category', 'tax_category', 'scope', 'confidence', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/** Categorise up to `BATCH` rows per request; returns suggestions keyed by id. */
export async function categorizeWithModel(rows: ModelInputRow[]): Promise<Map<string, ModelSuggestion>> {
  const out = new Map<string, ModelSuggestion>();
  if (!isModelCategorizationEnabled() || rows.length === 0) return out;
  const anthropic = getClient();

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const lines = batch.map((r) =>
      JSON.stringify({
        id: r.id,
        payee: r.payee,
        description: r.description,
        memo: r.memo,
        amount: r.amount,
        currency: r.currency,
        account: r.accountName,
        account_kind: r.accountKind,
        account_scope: r.accountScope,
      }),
    );

    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `Categorise these transactions. Return one item per input id.\n\n${lines.join('\n')}`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') continue;
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') continue;
    let parsed: { items?: Array<Record<string, unknown>> };
    try {
      parsed = JSON.parse(text.text);
    } catch {
      continue;
    }
    const ids = new Set(batch.map((r) => r.id));
    for (const item of parsed.items ?? []) {
      const id = String(item.id ?? '');
      if (!ids.has(id)) continue;
      const confidence = typeof item.confidence === 'number' ? Math.min(1, Math.max(0, item.confidence)) : 0;
      out.set(id, {
        id,
        category: item.category as ModelSuggestion['category'],
        taxCategory: item.tax_category as TaxCategory,
        scope: item.scope === 'personal' ? 'personal' : 'business',
        confidence,
        reason: String(item.reason ?? '').slice(0, 200),
      });
    }
  }
  return out;
}
