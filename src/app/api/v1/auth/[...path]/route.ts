import { NextRequest, NextResponse } from 'next/server';

function handler(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return params.then(({ path }) => {
    const correctPath = `/api/auth/${path.join('/')}`;
    return NextResponse.json(
      {
        error: `The /api/v1/auth/* routes have been removed. Use ${correctPath} instead.`,
        redirect: correctPath,
      },
      { status: 410 }
    );
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
