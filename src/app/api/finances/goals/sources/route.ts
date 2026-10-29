import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { financeErrorFromException, financeJson } from '@/lib/finances/api';
import { listAccounts } from '@/lib/finances/summary';
import { listMerchantWallets } from '@/lib/finances/goals-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/goals/sources — what a goal can be linked to: the
 * finance accounts (bank, card, loan feeds) and CoinPay web wallets this
 * merchant already has. Accounts hidden on /finances carry `hidden: true`.
 */
export async function GET(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.read');
  if (guard instanceof NextResponse) return guard;
  try {
    const [accounts, wallets] = await Promise.all([listAccounts(guard.id, { includeHidden: true }), listMerchantWallets(guard.id)]);
    return financeJson({
      // Hidden accounts are listed (flagged) so a goal already linked to one can show and unlink it.
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, institution: a.org_name, kind: a.effective_kind, liability: a.is_liability, currency: a.currency, balance: a.display_balance, asOf: a.balance_date, hidden: a.is_hidden })),
      wallets,
    });
  } catch (err) {
    return financeErrorFromException(err, 'Could not load link sources');
  }
}
