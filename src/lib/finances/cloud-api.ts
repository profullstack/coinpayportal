import 'server-only';
import { NextResponse } from 'next/server';
import { BrowserBusyError, LiveSessionError } from './cloud-browser';
import { CloudStatementsError } from './cloud-statements';
import { financeErrorFromException } from './api';

/** The finance error shape for the cloud statement routes' own errors. */
export function cloudError(err: unknown, fallback: string): NextResponse {
  if (err instanceof CloudStatementsError || err instanceof LiveSessionError || err instanceof BrowserBusyError) {
    const status = (err as { status: number }).status;
    return NextResponse.json(
      { error: { code: (err as { code: string }).code, message: err.message, retryable: status === 429 || status >= 500 } },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return financeErrorFromException(err, fallback);
}

export const INSTITUTION_KEY = /^[a-z0-9][a-z0-9-]{0,59}$/;
