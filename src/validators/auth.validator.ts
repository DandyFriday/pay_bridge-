import { z } from 'zod';

export const registerSchema = z.object({
  name: z
    .string({ required_error: 'Merchant name is required' })
    .trim()
    .min(2, 'Merchant name must be at least 2 characters')
    .max(100, 'Merchant name must be at most 100 characters'),
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .email('Invalid email address')
    .transform((val) => val.toLowerCase()),
  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
});

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .email('Invalid email address')
    .transform((val) => val.toLowerCase()),
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
});

export const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'API key name must be at least 2 characters')
    .max(60, 'API key name must be at most 60 characters')
    .default('Secret API Key'),
});

export const apiKeyIdParamsSchema = z.object({
  keyId: z.string().uuid('Invalid API key ID format'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
