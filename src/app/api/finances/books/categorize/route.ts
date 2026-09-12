import { NextRequest, NextResponse } from 'next/server';
import { requireMerchantForWrite } from '@/lib/auth/merchant-guard';
import { createCategorizeJob, toPublicJob } from '@/lib/finances/jobs';
import { isModelCategorizationEnabled } from '@/lib/finances/categorize-model';
import { financeErrorFromException, financeJson, readJsonBody } from '@/lib/finances/api';
import { audit } from '@/lib/finances/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finances/books/categorize — queue an auto-categorisation run
 * over every unreviewed row (rules, heuristics, then the model when one is
 * configured). Body: `{ useModel?: boolean, onlyUncategorized?: boolean }`.
 * Answers 202 with the job; reviewed rows are never touched.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMerchantForWrite(req);
  if (guard instanceof NextResponse) return guard;
  const body = await readJsonBody<{ useModel?: unknown; onlyUncategorized?: unknown }>(req);
  try {
    const job = await createCategorizeJob({
      merchantId: guard.id,
      useModel: body.useModel !== false,
      onlyUncategorized: body.onlyUncategorized === true,
    });
    await audit(guard.id, 'books.categorize.queue', 'job', job.id, { model: isModelCategorizationEnabled() });
    return financeJson({ job: toPublicJob(job), modelEnabled: isModelCategorizationEnabled() }, 202);
  } catch (err) {
    return financeErrorFromException(err, 'Could not queue categorisation');
  }
}
