import { LedgerEntryType } from '@prisma/client';
import { z } from 'zod';

export const ledgerEntriesQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .refine((val) => Number.isInteger(val) && val >= 1, 'page must be a positive integer'),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .refine((val) => Number.isInteger(val) && val >= 1 && val <= 100, 'limit must be between 1 and 100'),
  accountId: z.string().uuid('Invalid accountId format').optional(),
  entryType: z.nativeEnum(LedgerEntryType).optional(),
});

export const createPayoutSchema = z.object({
  amount: z
    .union([z.number().int().positive(), z.string().regex(/^\d+$/, 'Amount must be a positive integer in minor units')])
    .transform((val) => BigInt(val))
    .refine((val) => val > 0n, 'Payout amount must be greater than zero'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3, 'Currency must be a 3-letter ISO code')
    .default('NGN'),
  description: z
    .string()
    .trim()
    .min(3, 'Description must be at least 3 characters')
    .max(200, 'Description must be at most 200 characters')
    .default('Merchant payout settlement'),
});

export type LedgerEntriesQuery = z.infer<typeof ledgerEntriesQuerySchema>;
export type CreatePayoutInput = z.infer<typeof createPayoutSchema>;
