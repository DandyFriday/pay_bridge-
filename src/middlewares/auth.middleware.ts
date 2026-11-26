import { Request } from 'express';
import { prisma } from '../database/prisma';
import { asyncHandler } from '../utils/asyncHandler';
import { hashApiKey, verifyJwt } from '../utils/crypto';
import { AppError } from '../utils/errors';

/**
 * Extracts a Bearer token from the Authorization header when present.
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Protects dashboard and merchant-management routes using a JWT access token.
 */
export const requireJwtAuth = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req);
  if (!token) {
    throw new AppError(401, 'Missing or invalid Authorization header');
  }

  let payload;
  try {
    payload = verifyJwt(token);
  } catch {
    throw new AppError(401, 'Invalid or expired access token');
  }

  const merchant = await prisma.merchant.findUnique({
    where: { id: payload.merchantId },
    select: { id: true, name: true, email: true },
  });

  if (!merchant) {
    throw new AppError(401, 'Merchant account no longer exists');
  }

  req.merchant = merchant;
  next();
});

/**
 * Protects server-to-server payment gateway routes using an active secret API key.
 * Supports either `Authorization: Bearer <api_key>` or `x-api-key: <api_key>`.
 */
export const requireApiKeyAuth = asyncHandler(async (req, _res, next) => {
  const headerKey = req.headers['x-api-key'];
  const rawKey =
    extractBearerToken(req) ??
    (typeof headerKey === 'string' && headerKey.trim().length > 0
      ? headerKey.trim()
      : null);

  if (!rawKey) {
    throw new AppError(401, 'API key is required');
  }

  const keyHash = hashApiKey(rawKey);
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    select: {
      id: true,
      prefix: true,
      name: true,
      isActive: true,
      merchant: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  if (!apiKey || !apiKey.isActive) {
    throw new AppError(401, 'Invalid or revoked API key');
  }

  req.merchant = apiKey.merchant;
  req.apiKey = {
    id: apiKey.id,
    prefix: apiKey.prefix,
    name: apiKey.name,
  };
  next();
});
