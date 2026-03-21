import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { register } from '@/lib/auth/service';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getClientIp } from '@/lib/web-wallet/client-ip';
import { checkSpamSignup } from '@/lib/auth/spam-detection';
import { z } from 'zod';

/**
 * Request body schema
 */
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  name: z.string().optional(),
});

/**
 * POST /api/auth/register
 * Register a new merchant account
 */
export async function POST(request: NextRequest) {
  try {
    // Get client IP for rate limiting
    const clientIp = getClientIp(request);

    // Check rate limit (prevents mass account creation)
    const rateCheck = await checkRateLimitAsync(clientIp, 'merchant_register');
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many registration attempts. Please try again later.',
          retryAfter: rateCheck.resetAt - Math.floor(Date.now() / 1000),
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateCheck.resetAt - Math.floor(Date.now() / 1000)),
            'X-RateLimit-Limit': String(rateCheck.limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(rateCheck.resetAt),
          },
        }
      );
    }

    // Parse request body
    const body = await request.json();

    // Validate request body
    const validation = registerSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.errors[0].message,
        },
        { status: 400 }
      );
    }

    // Spam detection — block bots without CAPTCHAs
    const spamCheck = checkSpamSignup({
      name: validation.data.name,
      email: validation.data.email,
      honeypot: body.website, // hidden honeypot field
      registrationStartMs: body._ts ? Number(body._ts) : undefined,
    });

    if (spamCheck.blocked) {
      console.warn(
        `[spam-block] Blocked registration: ${validation.data.email} ` +
        `(score=${spamCheck.score}, reasons=${spamCheck.reasons.join(",")})`
      );
      // Return generic error — don't reveal spam detection
      return NextResponse.json(
        {
          success: false,
          error: 'Registration failed. Please try again later.',
        },
        { status: 400 }
      );
    }

    if (spamCheck.score > 0) {
      console.info(
        `[spam-warn] Suspicious registration: ${validation.data.email} ` +
        `(score=${spamCheck.score}, reasons=${spamCheck.reasons.join(",")})`
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

    // Register merchant
    const result = await register(supabase, validation.data);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: 400 }
      );
    }

    // Return success response
    return NextResponse.json(
      {
        success: true,
        merchant: result.merchant,
        token: result.token,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}