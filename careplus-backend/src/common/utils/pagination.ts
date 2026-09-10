import { Request } from "express";

export interface PageParams {
  page: number;
  limit: number;
  skip: number;
}

export function getPageParams(req: Request, defaultLimit = 20, maxLimit = 100): PageParams {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const rawLimit = parseInt(String(req.query.limit ?? String(defaultLimit)), 10) || defaultLimit;
  const limit = Math.min(Math.max(1, rawLimit), maxLimit);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}
