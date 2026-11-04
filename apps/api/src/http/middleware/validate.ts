import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

type Location = 'body' | 'params' | 'query';

/**
<<<<<<< HEAD
 * Validates `req[location]` against a Zod schema.
 *  - On success the PARSED value replaces the raw one, so handlers receive normalised data
 *    (upper-cased tenant codes, lower-cased Login IDs, real `Date` objects, defaults applied).
 *  - On failure the request is rejected with HTTP 422 / `VALIDATION_ERROR` and a readable message that the
 *    web UI shows as-is. Invalid input is NEVER forwarded to the handlers or the database.
=======
 * Validates and REPLACES req[location] with the parsed (and coerced/normalised) value.
 * On failure, responds 422 with field-level details rather than throwing - this is a
 * genuine client input problem, not a domain error, so it's handled here rather than
 * forwarded to the generic error handler.
>>>>>>> de44982ecba1541fc115d205eecbf37b454479f3
 */
export const validate =
  (schema: ZodType, location: Location = 'body') =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[location]);
<<<<<<< HEAD

    if (!result.success) {
      const issues = result.error.issues.map((issue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });
      res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: issues.slice(0, 5).join(' | ') || 'Invalid request.',
          issues,
=======
    if (!result.success) {
      res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
          issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
>>>>>>> de44982ecba1541fc115d205eecbf37b454479f3
        },
      });
      return;
    }
<<<<<<< HEAD

    if (location === 'query') {
      // Express 5 exposes `req.query` as a getter-only property, so it has to be redefined, not assigned.
=======
    if (location === 'query') {
      // Express 5's `req.query` is a getter-only accessor inherited from the
      // request prototype - a plain `req.query = ...` assignment throws
      // ("Cannot set property query of #<IncomingMessage> which has only a
      // getter") in strict-mode code (which all ESM modules are). Defining a
      // new OWN property on this specific `req` instance shadows the
      // inherited getter instead of trying to invoke a (non-existent)
      // inherited setter, so this works regardless of that accessor.
>>>>>>> de44982ecba1541fc115d205eecbf37b454479f3
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
<<<<<<< HEAD
      (req as unknown as Record<string, unknown>)[location] = result.data;
=======
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any)[location] = result.data;
>>>>>>> de44982ecba1541fc115d205eecbf37b454479f3
    }
    next();
  };
