import { NextRequest, NextResponse } from 'next/server';
import { requireFinanceAccess } from '@/lib/finances/access';
import { cloudStatementsAccess, merchantInstitutions } from '@/lib/finances/cloud-statements';
import { listBankSessions, toPublicSession } from '@/lib/finances/bank-sessions';
import { cloudError } from '@/lib/finances/cloud-api';
import { financeJson } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/finances/statements/cloud — whether this account may use CoinPay
 * cloud statement fetching (`access`), and every linked bank, plus the tax
 * sources (`kind: 'tax'`), with its cloud connection, if any (`banks`).
 */
export async function GET(req: NextRequest) {
  const guard = await requireFinanceAccess(req, 'finance.read');
  if (guard instanceof NextResponse) return guard;
  try {
    const [access, institutions, sessions] = await Promise.all([cloudStatementsAccess(guard), merchantInstitutions(guard.id), listBankSessions(guard.id)]);
    const banks = institutions.map((i) => {
      const session = sessions.find((s) => s.institution_key === i.key);
      return { key: i.key, name: i.name, kind: i.kind === 'tax' ? 'tax' : 'bank', url: i.url, accounts: i.accounts.map((a) => a.name), cloud: session ? toPublicSession(session) : null };
    });
    return financeJson({ access, banks });
  } catch (err) {
    return cloudError(err, 'Could not load cloud statement status');
  }
}
