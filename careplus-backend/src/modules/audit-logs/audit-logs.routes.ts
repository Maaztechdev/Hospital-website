import { Request, Response, Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess, paginationMeta } from "@common/utils/apiResponse";
import { getPageParams } from "@common/utils/pagination";

const listQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  module: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  userId: z.string().uuid().optional(),
  action: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const router = Router();
router.use(authenticate);

/**
 * @openapi
 * /audit-logs:
 *   get:
 *     tags: [Audit Logs]
 *     summary: Read-only, filterable audit trail (admin only). No delete endpoint exists — logs are immutable.
 *     responses:
 *       200: { description: OK }
 */
router.get(
  "/",
  requireRole(["ADMIN"]),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const page = getPageParams(req, 50, 200);
    const { module, entityType, entityId, userId, action, from, to } = req.query as Record<string, string | undefined>;

    const where: Prisma.AuditLogWhereInput = {
      ...(module ? { module } : {}),
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(userId ? { userId } : {}),
      ...(action ? { action: action as never } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, skip: page.skip, take: page.limit, orderBy: { createdAt: "desc" }, include: { user: { select: { id: true, name: true, email: true, role: true } } } }),
      prisma.auditLog.count({ where }),
    ]);

    sendSuccess(res, 200, { data: items, pagination: paginationMeta(page.page, page.limit, total) });
  })
);

export default router;
