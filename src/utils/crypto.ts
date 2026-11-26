import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

const BCRYPT_SALT_ROUNDS = 10;
const API_KEY_PREFIX = 'pb_test_';

export interface JwtPayload {
  merchantId: string;
  email: string;
}

/**
 * Hashes a plaintext password using bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

/**
 * Verifies a plaintext password against a stored bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Signs a short-lived JWT access token for dashboard/merchant authentication.
 */
export function signJwt(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '24h' });
}

/**
 * Verifies a JWT access token and returns its decoded merchant payload.
 */
export function verifyJwt(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === 'string' || !decoded.merchantId || !decoded.email) {
    throw new Error('Invalid token payload');
  }
  return {
    merchantId: String(decoded.merchantId),
    email: String(decoded.email),
  };
}

/**
 * Computes a deterministic SHA-256 hex digest for API key lookup and storage.
 */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Generates a new PayBridge API key, its display prefix, and its SHA-256 hash.
 */
export function generateApiKey(): { rawKey: string; prefix: string; keyHash: string } {
  const secretPart = crypto.randomBytes(24).toString('hex');
  const rawKey = `${API_KEY_PREFIX}${secretPart}`;
  const prefix = rawKey.slice(0, 16);
  const keyHash = hashApiKey(rawKey);
  return { rawKey, prefix, keyHash };
}
