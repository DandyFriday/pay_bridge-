import crypto from 'crypto';
import { Prisma, Transaction, TransactionStatus } from '@prisma/client';
import { prisma } from '../database/prisma';
import { AppError } from '../utils/errors';
import { recordPaymentSettlement } from './ledger.service';
import {
  AnalyticsRange,
  InitializePaymentInput,
  ListTransactionsQuery,
} from '../validators/payment.validator';

const FEE_RATE_NUMERATOR = 15n; // 1.5%
const FEE_RATE_DENOMINATOR = 1000n;
const MAX_FEE_MINOR_UNITS = 200000n; // Capped at ₦2,000.00 (200,000 kobo)

/**
 * Calculates the PayBridge processing fee (1.5%, capped at 200,000 minor units).
 */
export function calculateProcessingFee(amount: bigint): bigint {
  if (amount <= 0n) {
    return 0n;
  }
  const computed = (amount * FEE_RATE_NUMERATOR) / FEE_RATE_DENOMINATOR;
  return computed > MAX_FEE_MINOR_UNITS ? MAX_FEE_MINOR_UNITS : computed;
}

/**
 * Generates a unique, human-readable payment transaction reference.
 */
export function generateTransactionReference(): string {
  const timestamp = Date.now().toString(36);
  const randomSuffix = crypto.randomBytes(6).toString('hex');
  return `pb_tx_${timestamp}_${randomSuffix}`;
}

/**
 * Computes the inclusive date window for analytics filtering.
 */
export function getAnalyticsWindow(
  range: AnalyticsRange,
  now = new Date()
): { start: Date | null; end: Date | null } {
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  switch (range) {
    case 'today':
      return { start: startOfToday, end: null };
    case 'yesterday': {
      const start = new Date(startOfToday);
      start.setUTCDate(start.getUTCDate() - 1);
      return { start, end: startOfToday };
    }
    case 'week': {
      const start = new Date(startOfToday);
      start.setUTCDate(start.getUTCDate() - 6);
      return { start, end: null };
    }
    case 'month': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { start, end: null };
    }
    case 'year': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      return { start, end: null };
    }
    case 'all':
      return { start: null, end: null };
  }
}

function serializeTransaction(tx: Transaction) {
  return {
    id: tx.id,
    reference: tx.reference,
    merchantId: tx.merchantId,
    amount: tx.amount.toString(),
    currency: tx.currency,
    status: tx.status,
    customerEmail: tx.customerEmail,
    callbackUrl: tx.callbackUrl,
    paidAt: tx.paidAt,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
  };
}

/**
 * Initializes a new payment transaction in PENDING state and returns its checkout path.
 */
export async function initializePayment(
  merchantId: string,
  input: InitializePaymentInput
) {
  const reference = generateTransactionReference();

  const transaction = await prisma.transaction.create({
    data: {
      reference,
      merchantId,
      amount: input.amount,
      currency: input.currency,
      status: TransactionStatus.PENDING,
      customerEmail: input.customerEmail,
      callbackUrl: input.callbackUrl ?? null,
    },
  });

  return {
    transaction: serializeTransaction(transaction),
    checkoutUrl: `/checkout/${transaction.reference}`,
  };
}

/**
 * Verifies a transaction by reference for the authenticated merchant (API key flow).
 */
export async function verifyPaymentByReference(merchantId: string, reference: string) {
  const transaction = await prisma.transaction.findFirst({
    where: { reference, merchantId },
  });

  if (!transaction) {
    throw new AppError(404, 'Transaction not found');
  }

  return serializeTransaction(transaction);
}

/**
 * Fetches public checkout session details for a transaction reference.
 */
export async function getCheckoutSession(reference: string) {
  const transaction = await prisma.transaction.findUnique({
    where: { reference },
    include: {
      merchant: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!transaction) {
    throw new AppError(404, 'Checkout session not found');
  }

  return {
    reference: transaction.reference,
    amount: transaction.amount.toString(),
    currency: transaction.currency,
    status: transaction.status,
    customerEmail: transaction.customerEmail,
    callbackUrl: transaction.callbackUrl,
    merchantName: transaction.merchant.name,
    paidAt: transaction.paidAt,
    createdAt: transaction.createdAt,
  };
}

/**
 * Atomically transitions a PENDING checkout transaction to SUCCESS or FAILED.
 * On SUCCESS, posts the balanced double-entry settlement inside the same DB transaction.
 */
export async function completeCheckoutSession(
  reference: string,
  outcome: 'SUCCESS' | 'FAILED'
) {
  const targetStatus =
    outcome === 'SUCCESS' ? TransactionStatus.SUCCESS : TransactionStatus.FAILED;
  const paidAt = outcome === 'SUCCESS' ? new Date() : null;

  return prisma.$transaction(async (tx) => {
    // Conditional update prevents concurrent double-settlement of the same transaction.
    const claimed = await tx.transaction.updateMany({
      where: {
        reference,
        status: TransactionStatus.PENDING,
      },
      data: {
        status: targetStatus,
        paidAt,
      },
    });

    const transaction = await tx.transaction.findUnique({
      where: { reference },
    });

    if (!transaction) {
      throw new AppError(404, 'Checkout session not found');
    }

    if (claimed.count === 0) {
      throw new AppError(
        409,
        `Transaction has already been finalized with status ${transaction.status}`
      );
    }

    let ledgerSettlement: Awaited<ReturnType<typeof recordPaymentSettlement>> | null = null;

    if (targetStatus === TransactionStatus.SUCCESS) {
      const feeAmount = calculateProcessingFee(transaction.amount);
      ledgerSettlement = await recordPaymentSettlement(
        {
          transactionId: transaction.id,
          merchantId: transaction.merchantId,
          grossAmount: transaction.amount,
          feeAmount,
          currency: transaction.currency,
          description: `Checkout payment ${transaction.reference}`,
        },
        tx
      );
    }

    return {
      transaction: serializeTransaction(transaction),
      ledgerSettled: Boolean(ledgerSettlement),
      feeAmount: targetStatus === TransactionStatus.SUCCESS
        ? calculateProcessingFee(transaction.amount).toString()
        : '0',
    };
  });
}

/**
 * Returns paginated transactions for the authenticated merchant dashboard.
 */
export async function listMerchantTransactions(
  merchantId: string,
  query: ListTransactionsQuery
) {
  const where: Prisma.TransactionWhereInput = {
    merchantId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { reference: { contains: query.search, mode: 'insensitive' } },
            { customerEmail: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const skip = (query.page - 1) * query.limit;

  const [total, transactions] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    items: transactions.map(serializeTransaction),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

/**
 * Returns detailed transaction metadata and linked ledger entries for a merchant.
 */
export async function getMerchantTransactionDetail(merchantId: string, reference: string) {
  const transaction = await prisma.transaction.findFirst({
    where: { reference, merchantId },
    include: {
      ledgerEntries: {
        orderBy: { createdAt: 'asc' },
        include: {
          account: {
            select: {
              id: true,
              accountType: true,
              currency: true,
            },
          },
        },
      },
    },
  });

  if (!transaction) {
    throw new AppError(404, 'Transaction not found');
  }

  return {
    ...serializeTransaction(transaction),
    ledgerEntries: transaction.ledgerEntries.map((entry) => ({
      ...entry,
      amount: entry.amount.toString(),
    })),
  };
}

/**
 * Computes dashboard KPI totals, status distribution, and daily trends for a merchant.
 */
export async function getMerchantAnalytics(merchantId: string, range: AnalyticsRange) {
  const { start, end } = getAnalyticsWindow(range);

  const createdAtFilter: Prisma.DateTimeFilter | undefined =
    start || end
      ? {
          ...(start ? { gte: start } : {}),
          ...(end ? { lt: end } : {}),
        }
      : undefined;

  const transactions = await prisma.transaction.findMany({
    where: {
      merchantId,
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: {
      amount: true,
      status: true,
      createdAt: true,
    },
  });

  let totalAmount = 0n;
  let successfulAmount = 0n;
  let successfulCount = 0;
  let pendingCount = 0;
  let pendingAmount = 0n;
  let failedCount = 0;
  let failedAmount = 0n;

  const dailyBuckets = new Map<
    string,
    {
      date: string;
      totalCount: number;
      successfulCount: number;
      totalAmount: bigint;
      successfulAmount: bigint;
    }
  >();

  for (const tx of transactions) {
    totalAmount += tx.amount;

    const dateKey = tx.createdAt.toISOString().slice(0, 10);
    const bucket = dailyBuckets.get(dateKey) ?? {
      date: dateKey,
      totalCount: 0,
      successfulCount: 0,
      totalAmount: 0n,
      successfulAmount: 0n,
    };

    bucket.totalCount += 1;
    bucket.totalAmount += tx.amount;

    if (tx.status === TransactionStatus.SUCCESS) {
      successfulCount += 1;
      successfulAmount += tx.amount;
      bucket.successfulCount += 1;
      bucket.successfulAmount += tx.amount;
    } else if (tx.status === TransactionStatus.PENDING) {
      pendingCount += 1;
      pendingAmount += tx.amount;
    } else {
      failedCount += 1;
      failedAmount += tx.amount;
    }

    dailyBuckets.set(dateKey, bucket);
  }

  const totalCount = transactions.length;
  const successRate =
    totalCount > 0 ? Number(((successfulCount / totalCount) * 100).toFixed(2)) : 0;

  return {
    range,
    summary: {
      totalCount,
      totalAmount: totalAmount.toString(),
      successfulCount,
      successfulAmount: successfulAmount.toString(),
      successRate,
    },
    statusDistribution: {
      SUCCESS: { count: successfulCount, amount: successfulAmount.toString() },
      PENDING: { count: pendingCount, amount: pendingAmount.toString() },
      FAILED: { count: failedCount, amount: failedAmount.toString() },
    },
    trends: Array.from(dailyBuckets.values()).map((bucket) => ({
      date: bucket.date,
      totalCount: bucket.totalCount,
      successfulCount: bucket.successfulCount,
      totalAmount: bucket.totalAmount.toString(),
      successfulAmount: bucket.successfulAmount.toString(),
    })),
  };
}
