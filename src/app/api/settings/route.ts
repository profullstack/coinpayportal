import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { getSettings, updateSettings } from '@/lib/settings/service';
import { verifyToken } from '@/lib/auth/jwt';
import { getJwtSecret } from '@/lib/secrets';

/**
 * GET /api/settings
 * Fetch merchant settings
 */
export async function GET(request: NextRequest) {
  try {
    // Get auth token from header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    
    // Verify token
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    let payload;
    try {
      payload = verifyToken(token, jwtSecret);
    } catch (error) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const merchantId = payload.userId;

    // Fetch settings
    const result = await getSettings(supabaseAdmin, merchantId);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      settings: result.settings,
    });
  } catch (error) {
    console.error('Settings GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/settings
 * Update merchant settings
 */
export async function PUT(request: NextRequest) {
  try {
    // Get auth token from header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    
    // Verify token
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    let payload;
    try {
      payload = verifyToken(token, jwtSecret);
    } catch (error) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const merchantId = payload.userId;

    // Parse request body
    const body = await request.json();
    const { notifications_enabled, email_notifications, web_notifications } = body;

    // Validate input
    if (
      typeof notifications_enabled !== 'boolean' ||
      typeof email_notifications !== 'boolean' ||
      typeof web_notifications !== 'boolean'
    ) {
      return NextResponse.json(
        { success: false, error: 'Invalid settings format' },
        { status: 400 }
      );
    }

    // Update settings
    const result = await updateSettings(supabaseAdmin, merchantId, {
      notifications_enabled,
      email_notifications,
      web_notifications,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      settings: result.settings,
    });
  } catch (error) {
    console.error('Settings PUT error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}