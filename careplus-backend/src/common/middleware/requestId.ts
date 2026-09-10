import { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.id = (req.headers["x-request-id"] as string) || randomUUID();
  res.setHeader("x-request-id", req.id);
  next();
}
