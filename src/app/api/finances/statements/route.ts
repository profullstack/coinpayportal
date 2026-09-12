import { NextRequest, NextResponse } from 'next/server';
import { requireMerchant, requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { importStatement, listStatements, toPublicStatement, maxStatementBytes, StatementError } from '@/lib/finances/statements';
import { resolveFinanceTimezone } from '@/lib/finances/settings';
import { financeError, financeErrorFromException, financeJson, isFeatureEnabled, isUuid } from '@/lib/finances/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/finances/statements — import an original PDF.
 *
 * Multipart form: `file` (application/pdf), `accountId`, then either
 * `period` (2026-08 / 2026-Q3) or `from` + `to` (YYYY-MM-DD, `to`
 * exclusive), plus optional `timezone`, `institutionLabel`, `cycle`, `notes`.
 *
 * The file is inspected before anything is stored and refused with a
 * reason if it is not a clean, unencrypted PDF. Nothing is read out of it
 * into the ledger: this is a document, not a data source.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  if (!isFeatureEnabled('FINANCES_STATEMENT_IMPORTS_ENABLED')) return financeError('feature_disabled', 'Statement imports are disabled on this deployment', 503);

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxStatementBytes() + 64 * 1024) {
    return financeError('document_rejected', `The upload is larger than ${Math.floor(maxStatementBytes() / (1024 * 1024))} MiB`, 413);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return financeError('invalid_request', 'Expected a multipart form with a PDF file', 400);
  }
  const file = form.get('file');
  if (!(file instanceof File)) return financeError('invalid_request', 'A PDF file is required in the "file" field', 400);
  const str = (name: string): string | null => {
    const v = form.get(name);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const accountId = str('accountId');
  if (!accountId || !isUuid(accountId)) return financeError('invalid_request', 'accountId must be an owned account uuid', 400);
  const cycleRaw = str('cycle');
  const cycle = cycleRaw === 'monthly' || cycleRaw === 'quarterly' || cycleRaw === 'custom' ? cycleRaw : undefined;
  if (cycleRaw && !cycle) return financeError('invalid_request', 'cycle must be monthly, quarterly or custom', 400);

  try {
    const tz = await resolveFinanceTimezone(guard.id, str('timezone'));
    if (!tz) return financeError('timezone_required', 'Pass an IANA timezone such as America/Los_Angeles; it will be remembered.', 400);
    const bytes = Buffer.from(await file.arrayBuffer());
    const { statement, duplicateOf } = await importStatement({
      merchantId: guard.id,
      accountId,
      bytes,
      originalFilename: file.name || null,
      institutionLabel: str('institutionLabel'),
      cycle,
      period: str('period'),
      from: str('from'),
      to: str('to'),
      timezone: tz.timezone,
      notes: str('notes'),
    });
    return financeJson(
      {
        statement: toPublicStatement(statement),
        duplicateOf,
        note: 'The PDF was stored as supplied. No transactions were imported from it and its issuer was not verified.',
      },
      duplicateOf === statement.id ? 200 : 201,
    );
  } catch (err) {
    if (err instanceof StatementError) return financeError(err.code as never, err.message, err.status);
    return financeErrorFromException(err, 'Could not import the statement');
  }
}

/** GET /api/finances/statements?account=&period=&from=&to= — the library. */
export async function GET(req: NextRequest) {
  const guard = await requireMerchant(req);
  if (guard instanceof NextResponse) return guard;
  const q = req.nextUrl.searchParams;
  const parsedLimit = Number.parseInt(q.get('limit') ?? '', 10);
  try {
    const tz = await resolveFinanceTimezone(guard.id, q.get('timezone'), { remember: false });
    const statements = await listStatements(guard.id, {
      accountId: q.get('account'),
      period: q.get('period'),
      from: q.get('from'),
      to: q.get('to'),
      timezone: tz?.timezone ?? 'UTC',
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 100,
    });
    return financeJson({ statements: statements.map((s) => toPublicStatement(s)) });
  } catch (err) {
    return financeErrorFromException(err, 'Could not list statements');
  }
}
