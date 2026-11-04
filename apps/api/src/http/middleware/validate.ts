import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

type Location = 'body' | 'params' | 'query';

/**
 * Validates and REPLACES req[location] with the parsed (and coerced/normalised) value.
 * On failure, responds 422 with field-level details rather than throwing - this is a
 * genuine client input problem, not a domain error, so it's handled here rather than
 * forwarded to the generic error handler.
 */
export const validate =
  (schema: ZodType, location: Location = 'body') =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[location]);
    if (!result.success) {
      res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
          issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }
    if (location === 'query') {
      // Express 5's `req.query` is a getter-only accessor inherited from the
      // request prototype - a plain `req.query = ...` assignment throws
      // ("Cannot set property query of #<IncomingMessage> which has only a
      // getter") in strict-mode code (which all ESM modules are). Defining a
      // new OWN property on this specific `req` instance shadows the
      // inherited getter instead of trying to invoke a (non-existent)
      // inherited setter, so this works regardless of that accessor.
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any)[location] = result.data;
    }
    next();
  };
