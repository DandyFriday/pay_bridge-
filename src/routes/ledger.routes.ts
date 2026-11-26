import { Router } from 'express';
import * as ledgerController from '../controllers/ledger.controller';
import { requireJwtAuth } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validate.middleware';
import { createPayoutSchema, ledgerEntriesQuerySchema } from '../validators/ledger.validator';

export const ledgerRoutes = Router();

ledgerRoutes.use(requireJwtAuth);

ledgerRoutes.get('/accounts', ledgerController.getAccounts);
ledgerRoutes.get(
  '/entries',
  validateRequest(ledgerEntriesQuerySchema, 'query'),
  ledgerController.getEntries
);
ledgerRoutes.get('/reconcile', ledgerController.reconcile);
ledgerRoutes.post(
  '/payouts',
  validateRequest(createPayoutSchema),
  ledgerController.createPayout
);
