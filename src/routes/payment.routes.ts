import { Router } from 'express';
import * as paymentController from '../controllers/payment.controller';
import { requireApiKeyAuth, requireJwtAuth } from '../middlewares/auth.middleware';
import { requireIdempotencyKey } from '../middlewares/idempotency.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import {
  analyticsQuerySchema,
  completeCheckoutSchema,
  initializePaymentSchema,
  listTransactionsQuerySchema,
  referenceParamsSchema,
} from '../validators/payment.validator';

export const paymentRoutes = Router();

// Server-to-server merchant API endpoints (authenticated with API key)
paymentRoutes.post(
  '/initialize',
  requireApiKeyAuth,
  validateRequest(initializePaymentSchema),
  requireIdempotencyKey,
  paymentController.initializePayment
);
paymentRoutes.get(
  '/verify/:reference',
  requireApiKeyAuth,
  validateRequest(referenceParamsSchema, 'params'),
  paymentController.verifyPayment
);

// Simulated public checkout endpoints
paymentRoutes.get(
  '/checkout/:reference',
  validateRequest(referenceParamsSchema, 'params'),
  paymentController.getCheckoutSession
);
paymentRoutes.post(
  '/checkout/:reference/complete',
  validateRequest(referenceParamsSchema, 'params'),
  validateRequest(completeCheckoutSchema),
  paymentController.completeCheckout
);

// Merchant dashboard endpoints (authenticated with JWT)
paymentRoutes.get(
  '/analytics',
  requireJwtAuth,
  validateRequest(analyticsQuerySchema, 'query'),
  paymentController.getAnalytics
);
paymentRoutes.get(
  '/',
  requireJwtAuth,
  validateRequest(listTransactionsQuerySchema, 'query'),
  paymentController.listTransactions
);
paymentRoutes.get(
  '/:reference',
  requireJwtAuth,
  validateRequest(referenceParamsSchema, 'params'),
  paymentController.getTransactionDetail
);
