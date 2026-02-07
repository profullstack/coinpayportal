import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { login } from '@/lib/auth/service';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { z } from 'zod';

/**
 * Request body schema
 */
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Get client IP from request headers
 */
function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * POST /api/auth/login
 * Authenticate a merchant
 */
export async function POST(request: NextRequest) {
  try {
    // Get client IP for rate limiting
    const clientIp = getClientIp(request);

    // Check IP-based rate limit (prevents distributed brute-force)
    const ipRateCheck = await checkRateLimitAsync(clientIp, 'merchant_login');
    if (!ipRateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many login attempts. Please try again later.',
          retryAfter: ipRateCheck.resetAt - Math.floor(Date.now() / 1000),
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(ipRateCheck.resetAt - Math.floor(Date.now() / 1000)),
            'X-RateLimit-Limit': String(ipRateCheck.limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(ipRateCheck.resetAt),
          },
        }
      );
    }

    // Parse request body
    const body = await request.json();

    // Validate request body
    const validation = loginSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.errors[0].message,
        },
        { status: 400 }
      );
    }

    // Check email-based rate limit (prevents brute-force on single account)
    const emailKey = `email:${validation.data.email.toLowerCase()}`;
    const emailRateCheck = await checkRateLimitAsync(emailKey, 'merchant_login_email');
    if (!emailRateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many login attempts for this account. Please try again later.',
          retryAfter: emailRateCheck.resetAt - Math.floor(Date.now() / 1000),
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(emailRateCheck.resetAt - Math.floor(Date.now() / 1000)),
          },
        }
      );
    }

    // Create Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error',
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Login merchant
    const result = await login(supabase, validation.data);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: 401 }
      );
    }

    // Return success response
    return NextResponse.json(
      {
        success: true,
        merchant: result.merchant,
        token: result.token,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}