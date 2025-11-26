import jwt, { type SignOptions } from 'jsonwebtoken';

/**
 * Default token expiration time
 */
const DEFAULT_EXPIRATION = '24h';

/**
 * Generate a JWT token
 * @param {object} payload - Data to encode in the token
 * @param {string} secret - Secret key for signing
 * @param {string} expiresIn - Token expiration time (default: 24h)
 * @returns {string} JWT token
 */
export function generateToken(
  payload: Record<string, any>,
  secret: string,
  expiresIn: string | number = DEFAULT_EXPIRATION
): string {
  try {
    // Validate inputs
    if (!payload || Object.keys(payload).length === 0) {
      throw new Error('Payload cannot be empty');
    }
    if (!secret || secret.length === 0) {
      throw new Error('Secret cannot be empty');
    }

    // Generate token
    const options: SignOptions = {
      expiresIn: expiresIn as any,
      algorithm: 'HS256',
    };
    const token = jwt.sign(payload, secret, options);

    return token;
  } catch (error) {
    throw new Error(`Token generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Verify and decode a JWT token
 * @param {string} token - JWT token to verify
 * @param {string} secret - Secret key for verification
 * @returns {object} Decoded token payload
 */
export function verifyToken(token: string, secret: string): any {
  try {
    // Validate inputs
    if (!token || token.length === 0) {
      throw new Error('Token cannot be empty');
    }
    if (!secret || secret.length === 0) {
      throw new Error('Secret cannot be empty');
    }

    // Verify and decode token
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
    });

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    throw new Error(`Token verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Decode a JWT token without verification
 * @param {string} token - JWT token to decode
 * @returns {object | null} Decoded token payload or null if invalid
 */
export function decodeToken(token: string): any | null {
  try {
    // Validate input
    if (!token || token.length === 0) {
      return null;
    }

    // Decode without verification
    const decoded = jwt.decode(token);
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Check if a JWT token is expired
 * @param {string} token - JWT token to check
 * @returns {boolean} True if expired or invalid, false otherwise
 */
export function isTokenExpired(token: string): boolean {
  try {
    const decoded = decodeToken(token);
    
    if (!decoded || typeof decoded !== 'object') {
      return true;
    }

    // Check if token has expiration claim
    if (!decoded.exp) {
      return true;
    }

    // Compare expiration time with current time
    const currentTime = Math.floor(Date.now() / 1000);
    return decoded.exp < currentTime;
  } catch (error) {
    return true;
  }
}

/**
 * Extract user ID from token
 * @param {string} token - JWT token
 * @returns {string | null} User ID or null if not found
 */
export function getUserIdFromToken(token: string): string | null {
  try {
    const decoded = decodeToken(token);
    return decoded?.userId || decoded?.sub || null;
  } catch (error) {
    return null;
  }
}

/**
 * Refresh a token by generating a new one with the same payload
 * @param {string} token - Existing JWT token
 * @param {string} secret - Secret key
 * @param {string} expiresIn - New expiration time
 * @returns {string} New JWT token
 */
export function refreshToken(
  token: string,
  secret: string,
  expiresIn: string = DEFAULT_EXPIRATION
): string {
  try {
    // Decode the existing token (without verification to allow expired tokens)
    const decoded = decodeToken(token);
    
    if (!decoded || typeof decoded !== 'object') {
      throw new Error('Invalid token');
    }

    // Remove JWT standard claims
    const { iat, exp, nbf, ...payload } = decoded;

    // Generate new token with same payload
    return generateToken(payload, secret, expiresIn);
  } catch (error) {
    throw new Error(`Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create an access token for a user
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @param {string} secret - Secret key
 * @returns {string} JWT access token
 */
export function createAccessToken(
  userId: string,
  email: string,
  secret: string
): string {
  return generateToken(
    {
      userId,
      email,
      type: 'access',
    },
    secret,
    '15m' // Short-lived access token
  );
}

/**
 * Create a refresh token for a user
 * @param {string} userId - User ID
 * @param {string} secret - Secret key
 * @returns {string} JWT refresh token
 */
export function createRefreshToken(
  userId: string,
  secret: string
): string {
  return generateToken(
    {
      userId,
      type: 'refresh',
    },
    secret,
    '7d' // Long-lived refresh token
  );
}