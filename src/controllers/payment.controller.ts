import { Request, Response } from 'express';
import { getAuthenticatedMerchantId } from '../middlewares/auth.middleware';
import * as paymentService from '../services/payment.service';
import { asyncHandler } from '../utils/asyncHandler';
import {
  AnalyticsRange,
  ListTransactionsQuery,
} from '../validators/payment.validator';

export const initializePayment = asyncHandler(async (req: Request, res: Response) => {
  const merchantId = getAuthenticatedMerchantId(req);
  const result = await paymentService.initializePayment(merchantId, req.body);
  res.status(201).json({
    status: 'success',
    message: 'Payment initialized successfully',
    data: result,
  });
});

export const verifyPayment = asyncHandler(async (req: Request, res: Response) => {
  const merchantId = getAuthenticatedMerchantId(req);
  const transaction = await paymentService.verifyPaymentByReference(
    merchantId,
    String(req.params.reference)
  );
  res.status(200).json({
    status: 'success',
    data: transaction,
  });
});

export const getCheckoutSession = asyncHandler(async (req: Request, res: Response) => {
  const session = await paymentService.getCheckoutSession(String(req.params.reference));
  res.status(200).json({
    status: 'success',
    data: session,
  });
});

export const completeCheckout = asyncHandler(async (req: Request, res: Response) => {
  const result = await paymentService.completeCheckoutSession(
    String(req.params.reference),
    req.body.outcome
  );
  res.status(200).json({
    status: 'success',
    message: `Payment ${result.transaction.status.toLowerCase()}`,
    data: result,
  });
});

export const listTransactions = asyncHandler(async (req: Request, res: Response) => {
  const merchantId = getAuthenticatedMerchantId(req);
  const query = req.query as unknown as ListTransactionsQuery;
  const result = await paymentService.listMerchantTransactions(merchantId, query);
  res.status(200).json({
    status: 'success',
    data: result,
  });
});

export const getTransactionDetail = asyncHandler(async (req: Request, res: Response) => {
  const merchantId = getAuthenticatedMerchantId(req);
  const transaction = await paymentService.getMerchantTransactionDetail(
    merchantId,
    String(req.params.reference)
  );
  res.status(200).json({
    status: 'success',
    data: transaction,
  });
});

export const getAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const merchantId = getAuthenticatedMerchantId(req);
  const { range } = req.query as unknown as { range: AnalyticsRange };
  const analytics = await paymentService.getMerchantAnalytics(merchantId, range);
  res.status(200).json({
    status: 'success',
    data: analytics,
  });
});
