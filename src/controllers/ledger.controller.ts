import { Request, Response } from 'express';
import { getAuthenticatedMerchantId } from '../middlewares/auth.middleware';
import * as ledgerService from '../services/ledger.service';
import { asyncHandler } from '../utils/asyncHandler';
import { LedgerEntriesQuery } from '../validators/ledger.validator';

export const getAccounts = asyncHandler(async (req: Request, res: Response) => {
  const merchantId = getAuthenticatedMerchantId(req);
  const accounts = await ledgerService.listMerchantAccounts(merchantId);
  res.status(200).json({
    status: 'success',
    data: accounts,
  });
});

export const getEntries = asyncHandler(async (req: Request, res: Response) => {
  const merchantId = getAuthenticatedMerchantId(req);
  const query = req.query as unknown as LedgerEntriesQuery;
  const result = await ledgerService.listMerchantEntries(merchantId, query);
  res.status(200).json({
    status: 'success',
    data: result,
  });
});

export const reconcile = asyncHandler(async (req: Request, res: Response) => {
  const merchantId = getAuthenticatedMerchantId(req);
  const report = await ledgerService.reconcileMerchantAccounts(merchantId);
  res.status(200).json({
    status: 'success',
    data: report,
  });
});

export const createPayout = asyncHandler(async (req: Request, res: Response) => {
  const merchantId = getAuthenticatedMerchantId(req);
  const result = await ledgerService.createMerchantPayout(merchantId, req.body);
  res.status(201).json({
    status: 'success',
    message: 'Payout recorded in double-entry ledger',
    data: result,
  });
});
