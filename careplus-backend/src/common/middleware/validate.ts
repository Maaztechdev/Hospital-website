import { NextFunction, Request, Response } from "express";
import { AnyZodObject, ZodError } from "zod";
import { ValidationError } from "@common/errors/AppError";

interface ValidationSchemas {
  body?: AnyZodObject;
  query?: AnyZodObject;
  params?: AnyZodObject;
}

/**
 * Validates & sanitizes req.body/query/params against Zod schemas.
 * On failure, throws a 422 ValidationError with field-level details.
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as typeof req.query;
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(new ValidationError("Validation failed", err.flatten().fieldErrors));
        return;
      }
      next(err);
    }
  };
}
