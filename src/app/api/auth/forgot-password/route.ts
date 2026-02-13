import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requestPasswordReset } from '@/lib/auth/service';
import { sendEmail } from '@/lib/email';
import { checkRateLimitAsync } from '@/lib/web-wallet/rate-limit';
import { getClientIp } from '@/lib/web-wallet/client-ip';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
});

/**
 * POST /api/auth/forgot-password
 * Request a password reset email
 */
export async function POST(request: NextRequest) {
  try {
    const clientIp = getClientIp(request);
    const ipRateCheck = await checkRateLimitAsync(clientIp, 'merchant_login');
    if (!ipRateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const validation = schema.safeParse(body);
    if (!validation.success) {
      // Always return success to not leak info
      return NextResponse.json({ success: true });
    }

    const emailKey = `reset:${validation.data.email.toLowerCase()}`;
    const emailRateCheck = await checkRateLimitAsync(emailKey, 'merchant_login_email');
    if (!emailRateCheck.allowed) {
      // Still return success to not leak info
      return NextResponse.json({ success: true });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const result = await requestPasswordReset(supabase, validation.data.email);

    if (result.token) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://coinpayportal.com';
      const resetLink = `${appUrl}/reset-password?token=${result.token}`;

      await sendEmail({
        to: validation.data.email,
        subject: 'Reset your CoinPay password',
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #7c3aed;">Reset Your Password</h2>
            <p>You requested a password reset for your CoinPay account.</p>
            <p>Click the link below to set a new password. This link expires in 1 hour.</p>
            <p style="margin: 24px 0;">
              <a href="${resetLink}" style="background-color: #7c3aed; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">
                Reset Password
              </a>
            </p>
            <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
      });
    }

    // Always return success
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json({ success: true }); // Don't leak errors
  }
}
