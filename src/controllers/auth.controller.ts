import { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/errors';

function requireAuthenticatedMerchantId(req: Request): string {
  if (!req.merchant) {
    throw new AppError(401, 'Authentication required');
  }
  return req.merchant.id;
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.registerMerchant(req.body);
  res.status(201).json({
    status: 'success',
    message: 'Merchant registered successfully',
    data: result,
  });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.loginMerchant(req.body);
  res.status(200).json({
    status: 'success',
    message: 'Login successful',
    data: result,
  });
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const merchantId = requireAuthenticatedMerchantId(req);
  const profile = await authService.getMerchantProfile(merchantId);
  res.status(200).json({
    status: 'success',
    data: profile,
  });
});

export const createApiKey = asyncHandler(async (req: Request, res: Response) => {
  const merchantId = requireAuthenticatedMerchantId(req);
  const apiKey = await authService.createApiKey(merchantId, req.body);
  res.status(201).json({
    status: 'success',
    message: 'API key created. Store this secret safely; it will not be shown again.',
    data: apiKey,
  });
});

export const listApiKeys = asyncHandler(async (req: Request, res: Response) => {
  const merchantId = requireAuthenticatedMerchantId(req);
  const apiKeys = await authService.listApiKeys(merchantId);
  res.status(200).json({
    status: 'success',
    data: apiKeys,
  });
});

export const revokeApiKey = asyncHandler(async (req: Request, res: Response) => {
  const merchantId = requireAuthenticatedMerchantId(req);
  const apiKey = await authService.revokeApiKey(merchantId, String(req.params.keyId));
  res.status(200).json({
    status: 'success',
    message: 'API key revoked successfully',
    data: apiKey,
  });
});
