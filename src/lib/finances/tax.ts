import type { SpendCategory } from './classify';

/**
 * Tax categories for the books.
 *
 * These follow the shape of a US sole-proprietor Schedule C because that is
 * what a CPA asks for first, but they are a bookkeeping taxonomy, not tax
 * advice: the export says so, and the CPA decides what is deductible. Three
 * buckets are deliberately "excluded" rather than expense lines so a
 * transfer between two of your own accounts, a credit-card payment or an
 * estimated tax payment can never inflate the expense total.
 */

export const TAX_CATEGORIES = [
  'income_gross_receipts',
  'income_other',
  'advertising',
  'car_truck',
  'commissions_fees',
  'contract_labor',
  'insurance',
  'interest',
  'legal_professional',
  'office_expense',
  'rent_lease',
  'repairs_maintenance',
  'supplies',
  'taxes_licenses',
  'travel',
  'meals',
  'utilities',
  'wages',
  'software_subscriptions',
  'bank_fees',
  'education',
  'other_expense',
  'personal',
  'transfer',
  'owner_draw',
  'income_tax_payment',
  'uncategorized',
] as const;

export type TaxCategory = (typeof TAX_CATEGORIES)[number];

export function isTaxCategory(value: unknown): value is TaxCategory {
  return typeof value === 'string' && (TAX_CATEGORIES as readonly string[]).includes(value);
}

export const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  income_gross_receipts: 'Gross receipts',
  income_other: 'Other income',
  advertising: 'Advertising',
  car_truck: 'Car and truck',
  commissions_fees: 'Commissions and fees',
  contract_labor: 'Contract labor',
  insurance: 'Insurance',
  interest: 'Interest',
  legal_professional: 'Legal and professional',
  office_expense: 'Office expense',
  rent_lease: 'Rent or lease',
  repairs_maintenance: 'Repairs and maintenance',
  supplies: 'Supplies',
  taxes_licenses: 'Taxes and licenses',
  travel: 'Travel',
  meals: 'Meals',
  utilities: 'Utilities',
  wages: 'Wages',
  software_subscriptions: 'Software and subscriptions',
  bank_fees: 'Bank and processing fees',
  education: 'Education',
  other_expense: 'Other expense',
  personal: 'Personal (not deductible)',
  transfer: 'Transfer (excluded)',
  owner_draw: 'Owner draw (excluded)',
  income_tax_payment: 'Income tax payment (excluded)',
  uncategorized: 'Uncategorised',
};

/** Categories that are neither income nor expense in the books. */
export const EXCLUDED_TAX_CATEGORIES: ReadonlySet<TaxCategory> = new Set<TaxCategory>([
  'transfer',
  'owner_draw',
  'income_tax_payment',
  'personal',
]);

export const INCOME_TAX_CATEGORIES: ReadonlySet<TaxCategory> = new Set<TaxCategory>([
  'income_gross_receipts',
  'income_other',
]);

export function taxCategoryLabel(value: string | null | undefined): string {
  if (!value) return 'Uncategorised';
  return isTaxCategory(value) ? TAX_CATEGORY_LABELS[value] : value;
}

/**
 * The default tax bucket for a spend category and a scope.
 *
 * Personal-scope activity is `personal` whatever it bought. Business
 * activity maps by spend category; categories that describe a person's
 * life rather than a business (groceries, entertainment) land in
 * `uncategorized` on a business account so a human decides, rather than
 * being silently written off.
 */
export function defaultTaxCategory(
  category: SpendCategory | string | null | undefined,
  scope: 'business' | 'personal' | string,
  amountIsCredit: boolean,
): TaxCategory {
  if (category === 'transfer' || category === 'payment') return 'transfer';
  if (scope !== 'business') return 'personal';
  if (amountIsCredit) {
    if (category === 'income') return 'income_gross_receipts';
    if (category === 'fees') return 'income_other';
    return 'income_other';
  }
  switch (category) {
    case 'advertising':
      return 'advertising';
    case 'software':
      return 'software_subscriptions';
    case 'fees':
      return 'bank_fees';
    case 'dining':
      return 'meals';
    case 'travel':
      return 'travel';
    case 'transport':
    case 'fuel':
      return 'car_truck';
    case 'utilities':
      return 'utilities';
    case 'insurance':
      return 'insurance';
    case 'taxes':
      return 'taxes_licenses';
    case 'shopping':
      return 'supplies';
    case 'health':
    case 'groceries':
    case 'entertainment':
    case 'cash':
    case 'other':
    case null:
    case undefined:
      return 'uncategorized';
    default:
      return 'uncategorized';
  }
}
