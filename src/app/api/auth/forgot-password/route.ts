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
    // Per-IP first: this is the ATTACKER's bucket, and the one that should cost
    // them something. It reused `merchant_login`, which is a different budget
    // for a different action.
    const clientIp = getClientIp(request);
    const ipRateCheck = await checkRateLimitAsync(clientIp, 'password_reset_ip');
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

    // Then per-email (R4-ID-RESET). This is the VICTIM's bucket: an attacker
    // spending it on someone else's address locks that person out of their own
    // reset flow, and each request also replaces any reset token already in
    // flight. The per-IP limit above is what bounds that, which is why it is
    // checked first and is the tighter constraint in practice.
    //
    // Both categories are now dedicated. This one used `merchant_login` — 5 per
    // 5 minutes — while the comment described 3 per 15, so neither the budget
    // nor the window was what it claimed.
    const emailKey = `password_reset:${validation.data.email.toLowerCase()}`;
    const emailRateCheck = await checkRateLimitAsync(emailKey, 'password_reset_email');
    if (!emailRateCheck.allowed) {
      // Still return success to not leak info, but log it
      console.log(`[Forgot Password] Rate limited for ${validation.data.email}`);
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

      console.log(`[Forgot Password] Sending reset email to ${validation.data.email}`);
      const emailResult = await sendEmail({
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
      console.log(`[Forgot Password] Email result:`, emailResult);
    }

    // Always return success
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json({ success: true }); // Don't leak errors
  }
}
