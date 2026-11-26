import { LedgerAccount, LedgerAccountType, LedgerEntryType, Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';
import { AppError } from '../utils/errors';
import { CreatePayoutInput, LedgerEntriesQuery } from '../validators/ledger.validator';

export interface LedgerPostingLeg {
  accountId: string;
  entryType: LedgerEntryType;
  amount: bigint;
  description: string;
}

export interface PostDoubleEntryInput {
  transactionId?: string;
  legs: LedgerPostingLeg[];
}

export interface PaymentSettlementInput {
  transactionId: string;
  merchantId: string;
  grossAmount: bigint;
  feeAmount?: bigint;
  currency?: string;
  description?: string;
}

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Validates that a set of ledger legs satisfies double-entry bookkeeping invariants:
 * at least two positive legs, at least one debit and one credit, and SUM(DEBIT) === SUM(CREDIT).
 */
export function validateBalancedLedgerPosting(legs: LedgerPostingLeg[]): {
  totalDebits: bigint;
  totalCredits: bigint;
} {
  if (legs.length < 2) {
    throw new AppError(400, 'A double-entry posting requires at least 2 ledger legs');
  }

  let totalDebits = 0n;
  let totalCredits = 0n;
  let hasDebit = false;
  let hasCredit = false;

  for (const leg of legs) {
    if (leg.amount <= 0n) {
      throw new AppError(400, 'Ledger entry amount must be strictly positive');
    }
    if (!leg.description || leg.description.trim().length === 0) {
      throw new AppError(400, 'Ledger entry description is required');
    }

    if (leg.entryType === LedgerEntryType.DEBIT) {
      hasDebit = true;
      totalDebits += leg.amount;
    } else {
      hasCredit = true;
      totalCredits += leg.amount;
    }
  }

  if (!hasDebit || !hasCredit) {
    throw new AppError(400, 'A double-entry posting must include both DEBIT and CREDIT entries');
  }

  if (totalDebits !== totalCredits) {
    throw new AppError(
      400,
      `Unbalanced ledger posting: debits (${totalDebits.toString()}) must equal credits (${totalCredits.toString()})`
    );
  }

  return { totalDebits, totalCredits };
}

/**
 * Formats a LedgerAccount row for safe JSON responses by serializing BigInt balances.
 */
function serializeLedgerAccount(account: LedgerAccount) {
  return {
    id: account.id,
    merchantId: account.merchantId,
    accountType: account.accountType,
    currency: account.currency,
    balance: account.balance.toString(),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

/**
 * Finds or creates a merchant's primary ledger account for the given currency.
 */
export async function getOrCreateMerchantAccount(
  merchantId: string,
  currency = 'NGN',
  db: DbClient = prisma
): Promise<LedgerAccount> {
  const existing = await db.ledgerAccount.findFirst({
    where: {
      merchantId,
      accountType: LedgerAccountType.MERCHANT_MAIN,
      currency,
    },
  });

  if (existing) {
    return existing;
  }

  return db.ledgerAccount.create({
    data: {
      merchantId,
      accountType: LedgerAccountType.MERCHANT_MAIN,
      currency,
      balance: 0n,
    },
  });
}

/**
 * Finds or creates a platform-wide system ledger account (clearing or settlement).
 */
export async function getOrCreateSystemAccount(
  accountType: 'PAYBRIDGE_SETTLEMENT' | 'CUSTOMER_CLEARING',
  currency = 'NGN',
  db: DbClient = prisma
): Promise<LedgerAccount> {
  const existing = await db.ledgerAccount.findFirst({
    where: {
      merchantId: null,
      accountType,
      currency,
    },
  });

  if (existing) {
    return existing;
  }

  return db.ledgerAccount.create({
    data: {
      merchantId: null,
      accountType,
      currency,
      balance: 0n,
    },
  });
}

/**
 * Atomically records a balanced set of immutable ledger entries and updates account balances.
 * Credits increase account balance; debits decrease account balance.
 */
export async function postDoubleEntry(
  input: PostDoubleEntryInput,
  txClient?: Prisma.TransactionClient
) {
  validateBalancedLedgerPosting(input.legs);

  const execute = async (tx: Prisma.TransactionClient) => {
    // Sort unique account IDs deterministically to avoid lock-ordering deadlocks.
    const uniqueAccountIds = Array.from(new Set(input.legs.map((leg) => leg.accountId))).sort();

    const accounts = await tx.ledgerAccount.findMany({
      where: { id: { in: uniqueAccountIds } },
    });

    if (accounts.length !== uniqueAccountIds.length) {
      throw new AppError(404, 'One or more target ledger accounts do not exist');
    }

    const accountMap = new Map(accounts.map((acc) => [acc.id, acc]));
    const baseCurrency = accounts[0].currency;
    for (const acc of accounts) {
      if (acc.currency !== baseCurrency) {
        throw new AppError(400, 'All legs in a double-entry posting must share the same currency');
      }
    }

    // Compute net balance delta per account so each account receives one atomic update.
    const balanceDeltas = new Map<string, bigint>();
    for (const leg of input.legs) {
      const signedDelta = leg.entryType === LedgerEntryType.CREDIT ? leg.amount : -leg.amount;
      balanceDeltas.set(leg.accountId, (balanceDeltas.get(leg.accountId) ?? 0n) + signedDelta);
    }

    const updatedAccounts: LedgerAccount[] = [];
    for (const accountId of uniqueAccountIds) {
      const delta = balanceDeltas.get(accountId) ?? 0n;
      const account = accountMap.get(accountId)!;

      if (delta === 0n) {
        updatedAccounts.push(account);
        continue;
      }

      const updated = await tx.ledgerAccount.update({
        where: { id: accountId },
        data: {
          balance: delta > 0n ? { increment: delta } : { decrement: -delta },
        },
      });

      if (updated.accountType === LedgerAccountType.MERCHANT_MAIN && updated.balance < 0n) {
        throw new AppError(400, 'Insufficient merchant ledger balance');
      }

      updatedAccounts.push(updated);
    }

    const createdEntries = await Promise.all(
      input.legs.map((leg) =>
        tx.ledgerEntry.create({
          data: {
            transactionId: input.transactionId ?? null,
            accountId: leg.accountId,
            entryType: leg.entryType,
            amount: leg.amount,
            description: leg.description.trim(),
          },
        })
      )
    );

    return {
      entries: createdEntries.map((entry) => ({
        ...entry,
        amount: entry.amount.toString(),
      })),
      accounts: updatedAccounts.map(serializeLedgerAccount),
    };
  };

  if (txClient) {
    return execute(txClient);
  }

  return prisma.$transaction(execute);
}

/**
 * Records a completed customer payment into the double-entry ledger:
 * DEBIT CUSTOMER_CLEARING (gross) -> CREDIT MERCHANT_MAIN (net) [+ CREDIT PAYBRIDGE_SETTLEMENT (fee)].
 */
export async function recordPaymentSettlement(
  input: PaymentSettlementInput,
  txClient?: Prisma.TransactionClient
) {
  const currency = input.currency ?? 'NGN';
  const feeAmount = input.feeAmount ?? 0n;

  if (input.grossAmount <= 0n) {
    throw new AppError(400, 'Gross payment amount must be positive');
  }
  if (feeAmount < 0n || feeAmount >= input.grossAmount) {
    throw new AppError(400, 'Fee amount must be non-negative and less than gross amount');
  }

  const netAmount = input.grossAmount - feeAmount;
  const baseDescription = input.description ?? `Payment settlement for transaction ${input.transactionId}`;

  const execute = async (tx: Prisma.TransactionClient) => {
    const [clearingAccount, merchantAccount] = await Promise.all([
      getOrCreateSystemAccount(LedgerAccountType.CUSTOMER_CLEARING, currency, tx),
      getOrCreateMerchantAccount(input.merchantId, currency, tx),
    ]);

    const legs: LedgerPostingLeg[] = [
      {
        accountId: clearingAccount.id,
        entryType: LedgerEntryType.DEBIT,
        amount: input.grossAmount,
        description: `${baseDescription} (customer clearing)`,
      },
      {
        accountId: merchantAccount.id,
        entryType: LedgerEntryType.CREDIT,
        amount: netAmount,
        description: `${baseDescription} (merchant credit)`,
      },
    ];

    if (feeAmount > 0n) {
      const settlementAccount = await getOrCreateSystemAccount(
        LedgerAccountType.PAYBRIDGE_SETTLEMENT,
        currency,
        tx
      );
      legs.push({
        accountId: settlementAccount.id,
        entryType: LedgerEntryType.CREDIT,
        amount: feeAmount,
        description: `${baseDescription} (processing fee)`,
      });
    }

    return postDoubleEntry({ transactionId: input.transactionId, legs }, tx);
  };

  if (txClient) {
    return execute(txClient);
  }

  return prisma.$transaction(execute);
}

/**
 * Debits a merchant's available balance and credits PAYBRIDGE_SETTLEMENT to record a payout.
 */
export async function createMerchantPayout(merchantId: string, input: CreatePayoutInput) {
  return prisma.$transaction(async (tx) => {
    const [merchantAccount, settlementAccount] = await Promise.all([
      getOrCreateMerchantAccount(merchantId, input.currency, tx),
      getOrCreateSystemAccount(LedgerAccountType.PAYBRIDGE_SETTLEMENT, input.currency, tx),
    ]);

    return postDoubleEntry(
      {
        legs: [
          {
            accountId: merchantAccount.id,
            entryType: LedgerEntryType.DEBIT,
            amount: input.amount,
            description: input.description,
          },
          {
            accountId: settlementAccount.id,
            entryType: LedgerEntryType.CREDIT,
            amount: input.amount,
            description: `${input.description} (settlement outflow)`,
          },
        ],
      },
      tx
    );
  });
}

/**
 * Lists all ledger accounts owned by the authenticated merchant.
 */
export async function listMerchantAccounts(merchantId: string) {
  const accounts = await prisma.ledgerAccount.findMany({
    where: { merchantId },
    orderBy: [{ currency: 'asc' }, { createdAt: 'asc' }],
  });

  return accounts.map(serializeLedgerAccount);
}

/**
 * Returns paginated immutable ledger entries across the authenticated merchant's accounts.
 */
export async function listMerchantEntries(merchantId: string, query: LedgerEntriesQuery) {
  const where: Prisma.LedgerEntryWhereInput = {
    account: { merchantId },
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.entryType ? { entryType: query.entryType } : {}),
  };

  const skip = (query.page - 1) * query.limit;

  const [total, entries] = await Promise.all([
    prisma.ledgerEntry.count({ where }),
    prisma.ledgerEntry.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        account: {
          select: {
            id: true,
            accountType: true,
            currency: true,
          },
        },
        transaction: {
          select: {
            id: true,
            reference: true,
            status: true,
          },
        },
      },
    }),
  ]);

  return {
    items: entries.map((entry) => ({
      ...entry,
      amount: entry.amount.toString(),
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

/**
 * Reconciles each merchant ledger account by comparing stored balance against SUM(CREDIT) - SUM(DEBIT).
 */
export async function reconcileMerchantAccounts(merchantId: string) {
  const accounts = await prisma.ledgerAccount.findMany({
    where: { merchantId },
    orderBy: { currency: 'asc' },
  });

  const reconciliations = await Promise.all(
    accounts.map(async (account) => {
      const grouped = await prisma.ledgerEntry.groupBy({
        by: ['entryType'],
        where: { accountId: account.id },
        _sum: { amount: true },
      });

      let totalCredits = 0n;
      let totalDebits = 0n;
      for (const row of grouped) {
        const sum = row._sum.amount ?? 0n;
        if (row.entryType === LedgerEntryType.CREDIT) {
          totalCredits = sum;
        } else {
          totalDebits = sum;
        }
      }

      const computedBalance = totalCredits - totalDebits;

      return {
        accountId: account.id,
        accountType: account.accountType,
        currency: account.currency,
        storedBalance: account.balance.toString(),
        computedBalance: computedBalance.toString(),
        totalCredits: totalCredits.toString(),
        totalDebits: totalDebits.toString(),
        isBalanced: account.balance === computedBalance,
      };
    })
  );

  return {
    allBalanced: reconciliations.every((item) => item.isBalanced),
    accounts: reconciliations,
  };
}
