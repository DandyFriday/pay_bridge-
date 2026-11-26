import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';
import { AppError } from '../utils/errors';

type RequestSource = 'body' | 'params' | 'query';

/**
 * Validates a request segment against a Zod schema and replaces it with parsed output.
 */
export function validateRequest(schema: ZodSchema, source: RequestSource = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const formattedErrors = result.error.errors.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      next(new AppError(400, 'Validation failed', formattedErrors));
      return;
    }

    req[source] = result.data;
    next();
  };
}
