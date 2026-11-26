import { TransactionStatus } from '@prisma/client';
import { z } from 'zod';

export const initializePaymentSchema = z.object({
  amount: z
    .union([
      z.number().int().positive('Amount must be a positive integer in minor units'),
      z.string().regex(/^\d+$/, 'Amount must be a positive integer in minor units'),
    ])
    .transform((val) => BigInt(val))
    .refine((val) => val > 0n, 'Amount must be greater than zero'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3, 'Currency must be a 3-letter ISO code')
    .default('NGN'),
  customerEmail: z
    .string({ required_error: 'customerEmail is required' })
    .trim()
    .email('Invalid customer email address')
    .transform((val) => val.toLowerCase()),
  callbackUrl: z
    .string()
    .trim()
    .url('callbackUrl must be a valid URL')
    .refine(
      (url) => url.startsWith('http://') || url.startsWith('https://'),
      'callbackUrl must use http or https'
    )
    .optional(),
});

export const referenceParamsSchema = z.object({
  reference: z
    .string({ required_error: 'Transaction reference is required' })
    .trim()
    .min(4, 'Invalid transaction reference')
    .max(100, 'Invalid transaction reference'),
});

export const completeCheckoutSchema = z.object({
  outcome: z.enum(['SUCCESS', 'FAILED'], {
    required_error: 'outcome must be SUCCESS or FAILED',
  }),
});

export const listTransactionsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .refine((val) => Number.isInteger(val) && val >= 1, 'page must be a positive integer'),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .refine(
      (val) => Number.isInteger(val) && val >= 1 && val <= 100,
      'limit must be between 1 and 100'
    ),
  status: z.nativeEnum(TransactionStatus).optional(),
  search: z.string().trim().max(100).optional(),
});

export const analyticsQuerySchema = z.object({
  range: z
    .enum(['today', 'yesterday', 'week', 'month', 'year', 'all'])
    .default('month'),
});

export type InitializePaymentInput = z.infer<typeof initializePaymentSchema>;
export type CompleteCheckoutInput = z.infer<typeof completeCheckoutSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
export type AnalyticsRange = z.infer<typeof analyticsQuerySchema>['range'];
