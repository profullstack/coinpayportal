import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/auth/logout
 * Logout the current user
 * 
 * Since we use JWT tokens (stateless), logout is handled client-side
 * by removing the token from storage. This endpoint exists for:
 * 1. API consistency
 * 2. Future token blacklisting if needed
 * 3. Clearing any server-side session data if implemented
 */
export async function POST(request: NextRequest) {
  try {
    // In a stateless JWT system, the actual logout happens client-side
    // by removing the token from localStorage/cookies
    
    // This endpoint can be used for:
    // - Token blacklisting (if implemented)
    // - Audit logging
    // - Clearing server-side sessions (if implemented)
    
    // Create response
    const response = NextResponse.json(
      {
        success: true,
        message: 'Logged out successfully',
      },
      { status: 200 }
    );

    // Clear any auth cookies if they exist
    response.cookies.delete('auth-token');
    response.cookies.delete('refresh-token');

    return response;
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/logout
 * Alternative logout method for simple redirects
 */
export async function GET(request: NextRequest) {
  try {
    const response = NextResponse.json(
      {
        success: true,
        message: 'Logged out successfully',
      },
      { status: 200 }
    );

    // Clear any auth cookies
    response.cookies.delete('auth-token');
    response.cookies.delete('refresh-token');

    return response;
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}