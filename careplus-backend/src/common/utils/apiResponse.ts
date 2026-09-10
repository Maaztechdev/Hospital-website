import { Response } from "express";

interface Pagination {
  page: number;
  limit: number;
  total: number;
}

interface EnvelopeOptions<T> {
  data?: T;
  message?: string;
  errors?: unknown;
  pagination?: Pagination;
}

/**
 * Consistent response envelope: { success, data, message, errors, pagination? }
 */
export function sendSuccess<T>(res: Response, statusCode: number, opts: EnvelopeOptions<T> = {}): Response {
  return res.status(statusCode).json({
    success: true,
    data: opts.data ?? null,
    message: opts.message ?? null,
    errors: null,
    ...(opts.pagination ? { pagination: opts.pagination } : {}),
  });
}

export function sendError(res: Response, statusCode: number, message: string, errors: unknown = null): Response {
  return res.status(statusCode).json({
    success: false,
    data: null,
    message,
    errors,
  });
}

export function paginationMeta(page: number, limit: number, total: number): Pagination {
  return { page, limit, total };
}
