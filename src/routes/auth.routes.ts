import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { requireJwtAuth } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import {
  apiKeyIdParamsSchema,
  createApiKeySchema,
  loginSchema,
  registerSchema,
} from '../validators/auth.validator';

export const authRoutes = Router();

authRoutes.post('/register', validateRequest(registerSchema), authController.register);
authRoutes.post('/login', validateRequest(loginSchema), authController.login);

authRoutes.get('/me', requireJwtAuth, authController.getMe);
authRoutes.post(
  '/api-keys',
  requireJwtAuth,
  validateRequest(createApiKeySchema),
  authController.createApiKey
);
authRoutes.get('/api-keys', requireJwtAuth, authController.listApiKeys);
authRoutes.patch(
  '/api-keys/:keyId/revoke',
  requireJwtAuth,
  validateRequest(apiKeyIdParamsSchema, 'params'),
  authController.revokeApiKey
);
