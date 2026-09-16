import { verifyToken } from './auth/jwt';

/** Only a signed, unexpired dashboard session earns an account allowance. */
export function explorerAccount(request: Request): string | null {
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  const cookie = /(?:^|;\s*)token=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
  const secret = process.env['JWT_SECRET'];
  if (!secret) return null;
  try {
    const payload = verifyToken(bearer || cookie || '', secret);
    if (payload.type && payload.type !== 'access') return null;
    if (typeof payload.exp !== 'number' || typeof payload.email !== 'string') return null;
    return typeof payload.userId === 'string' && payload.userId.length > 0 ? payload.userId : null;
  } catch {
    return null;
  }
}
