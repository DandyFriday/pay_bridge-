import { Prisma } from '@prisma/client';
import { NextFunction, Request, Response } from 'express';
import { prisma } from '../database/prisma';
import { getAuthenticatedMerchantId } from './auth.middleware';
import { AppError } from '../utils/errors';

const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 128;

/**
 * Produces a deterministic JSON string with sorted object keys for parameter comparison.
 */
export function canonicalStringify(value: unknown): string {
  if (typeof value === 'bigint') {
    return JSON.stringify(value.toString());
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys
    .filter((key) => obj[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(obj[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Compares two JSON payloads regardless of object property ordering.
 */
export function areIdempotentParamsEqual(a: unknown, b: unknown): boolean {
  return canonicalStringify(a ?? null) === canonicalStringify(b ?? null);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(canonicalStringify(value)) as Prisma.InputJsonValue;
}

/**
 * Enforces `Idempotency-Key` protection on payment initialization endpoints.
 * Replays stored responses for identical retries and rejects conflicting reuse.
 */
export async function requireIdempotencyKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const merchantId = getAuthenticatedMerchantId(req);
    const rawKey = req.headers['idempotency-key'];
    const idempotencyKey = typeof rawKey === 'string' ? rawKey.trim() : '';

    if (
      idempotencyKey.length < MIN_KEY_LENGTH ||
      idempotencyKey.length > MAX_KEY_LENGTH
    ) {
      throw new AppError(
        400,
        `Idempotency-Key header is required and must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters`
      );
    }

    const requestPath = req.originalUrl.split('?')[0];
    const existing = await prisma.idempotencyKey.findUnique({
      where: {
        merchantId_key: {
          merchantId,
          key: idempotencyKey,
        },
      },
    });

    if (existing) {
      if (
        existing.requestPath !== requestPath ||
        !areIdempotentParamsEqual(existing.requestParams, req.body)
      ) {
        throw new AppError(
          422,
          'Idempotency-Key was already used with a different request path or payload'
        );
      }

      if (existing.responseCode !== null && existing.responseBody !== null) {
        res.setHeader('X-Idempotent-Replayed', 'true');
        res.status(existing.responseCode).json(existing.responseBody);
        return;
      }

      throw new AppError(
        409,
        'A request with this Idempotency-Key is currently being processed'
      );
    }

    let lockRecordId: string;
    try {
      const created = await prisma.idempotencyKey.create({
        data: {
          merchantId,
          key: idempotencyKey,
          requestPath,
          requestParams: toJsonValue(req.body),
        },
        select: { id: true },
      });
      lockRecordId = created.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(
          409,
          'A request with this Idempotency-Key is currently being processed'
        );
      }
      throw error;
    }

    let settled = false;
    const originalJson = res.json.bind(res);

    res.json = ((body: unknown) => {
      if (!settled) {
        settled = true;
        if (res.statusCode >= 500) {
          void prisma.idempotencyKey
            .deleteMany({ where: { id: lockRecordId, responseCode: null } })
            .catch(() => undefined);
        } else {
          void prisma.idempotencyKey
            .update({
              where: { id: lockRecordId },
              data: {
                responseCode: res.statusCode,
                responseBody: toJsonValue(body),
              },
            })
            .catch(() => undefined);
        }
      }
      return originalJson(body);
    }) as Response['json'];

    res.on('close', () => {
      if (!settled && !res.writableEnded) {
        settled = true;
        void prisma.idempotencyKey
          .deleteMany({ where: { id: lockRecordId, responseCode: null } })
          .catch(() => undefined);
      }
    });

    next();
  } catch (error) {
    next(error);
  }
}
