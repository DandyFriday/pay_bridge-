import { LedgerAccountType } from '@prisma/client';
import { prisma } from '../database/prisma';
import { AppError } from '../utils/errors';
import {
  generateApiKey,
  hashPassword,
  signJwt,
  verifyPassword,
} from '../utils/crypto';
import { CreateApiKeyInput, LoginInput, RegisterInput } from '../validators/auth.validator';

const DEFAULT_CURRENCY = 'NGN';

/**
 * Registers a new merchant, provisions their main NGN ledger account,
 * and issues an initial API key plus a JWT access token.
 */
export async function registerMerchant(input: RegisterInput) {
  const existingMerchant = await prisma.merchant.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existingMerchant) {
    throw new AppError(409, 'A merchant with this email already exists');
  }

  const passwordHash = await hashPassword(input.password);
  const { rawKey, prefix, keyHash } = generateApiKey();

  const result = await prisma.$transaction(async (tx) => {
    const merchant = await tx.merchant.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
      },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
    });

    await tx.ledgerAccount.create({
      data: {
        merchantId: merchant.id,
        accountType: LedgerAccountType.MERCHANT_MAIN,
        currency: DEFAULT_CURRENCY,
        balance: 0n,
      },
    });

    const apiKey = await tx.apiKey.create({
      data: {
        merchantId: merchant.id,
        keyHash,
        prefix,
        name: 'Default API Key',
      },
      select: {
        id: true,
        name: true,
        prefix: true,
        isActive: true,
        createdAt: true,
      },
    });

    return { merchant, apiKey };
  });

  const token = signJwt({
    merchantId: result.merchant.id,
    email: result.merchant.email,
  });

  return {
    merchant: result.merchant,
    token,
    apiKey: {
      ...result.apiKey,
      // Returned once at creation; only the SHA-256 hash is persisted.
      key: rawKey,
    },
  };
}

/**
 * Authenticates a merchant with email and password and issues a JWT access token.
 */
export async function loginMerchant(input: LoginInput) {
  const merchant = await prisma.merchant.findUnique({
    where: { email: input.email },
    select: {
      id: true,
      name: true,
      email: true,
      passwordHash: true,
      createdAt: true,
    },
  });

  if (!merchant) {
    throw new AppError(401, 'Invalid email or password');
  }

  const isPasswordValid = await verifyPassword(input.password, merchant.passwordHash);
  if (!isPasswordValid) {
    throw new AppError(401, 'Invalid email or password');
  }

  const token = signJwt({
    merchantId: merchant.id,
    email: merchant.email,
  });

  return {
    merchant: {
      id: merchant.id,
      name: merchant.name,
      email: merchant.email,
      createdAt: merchant.createdAt,
    },
    token,
  };
}

/**
 * Returns the authenticated merchant profile and ledger account balances.
 */
export async function getMerchantProfile(merchantId: string) {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      ledgerAccounts: {
        select: {
          id: true,
          accountType: true,
          currency: true,
          balance: true,
          createdAt: true,
        },
      },
    },
  });

  if (!merchant) {
    throw new AppError(404, 'Merchant not found');
  }

  return {
    ...merchant,
    ledgerAccounts: merchant.ledgerAccounts.map((account) => ({
      ...account,
      // BigInt values cannot be serialized directly by JSON.stringify.
      balance: account.balance.toString(),
    })),
  };
}

/**
 * Creates a new secret API key for the authenticated merchant.
 */
export async function createApiKey(merchantId: string, input: CreateApiKeyInput) {
  const { rawKey, prefix, keyHash } = generateApiKey();

  const apiKey = await prisma.apiKey.create({
    data: {
      merchantId,
      name: input.name,
      prefix,
      keyHash,
    },
    select: {
      id: true,
      name: true,
      prefix: true,
      isActive: true,
      createdAt: true,
    },
  });

  return {
    ...apiKey,
    key: rawKey,
  };
}

/**
 * Lists all API keys belonging to a merchant without exposing key hashes.
 */
export async function listApiKeys(merchantId: string) {
  return prisma.apiKey.findMany({
    where: { merchantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      prefix: true,
      isActive: true,
      createdAt: true,
    },
  });
}

/**
 * Revokes an API key owned by the authenticated merchant.
 */
export async function revokeApiKey(merchantId: string, keyId: string) {
  const existingKey = await prisma.apiKey.findFirst({
    where: { id: keyId, merchantId },
    select: { id: true, isActive: true },
  });

  if (!existingKey) {
    throw new AppError(404, 'API key not found');
  }

  if (!existingKey.isActive) {
    throw new AppError(400, 'API key is already revoked');
  }

  return prisma.apiKey.update({
    where: { id: keyId },
    data: { isActive: false },
    select: {
      id: true,
      name: true,
      prefix: true,
      isActive: true,
      createdAt: true,
    },
  });
}
