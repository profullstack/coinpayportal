/**
 * Shared OAuth authentication utility
 */
import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth/jwt';

/**
 * Extract authenticated user from request Authorization header
 */
export function getAuthUser(request: NextRequest): { id: string } | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    const decoded = verifyToken(token, secret);
    if (decoded?.userId) return { id: decoded.userId };
  } catch {
    // invalid
  }

  return null;
}
