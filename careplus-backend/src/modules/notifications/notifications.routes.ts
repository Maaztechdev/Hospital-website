import { Request, Response, Router } from "express";
import { z } from "zod";
import { prisma } from "@config/prisma";
import { NotFoundError, UnauthorizedError, ForbiddenError } from "@common/errors/AppError";
import { authenticate } from "@common/middleware/authenticate";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess, paginationMeta } from "@common/utils/apiResponse";
import { getPageParams } from "@common/utils/pagination";

const idParamSchema = z.object({ id: z.string().uuid() });
const listQuerySchema = z.object({ page: z.string().optional(), limit: z.string().optional(), unreadOnly: z.enum(["true", "false"]).optional() });

const notificationsService = {
  async list(userId: string, params: { skip: number; limit: number; unreadOnly?: string }) {
    const where = { userId, ...(params.unreadOnly === "true" ? { isRead: false } : {}) };
    const [items, total] = await Promise.all([
      prisma.notification.findMany({ where, skip: params.skip, take: params.limit, orderBy: { createdAt: "desc" } }),
      prisma.notification.count({ where }),
    ]);
    return { items, total };
  },

  async markRead(userId: string, id: string) {
    const notif = await prisma.notification.findUnique({ where: { id } });
    if (!notif) throw new NotFoundError("Notification not found");
    if (notif.userId !== userId) throw new ForbiddenError("Cannot modify another user's notification");
    return prisma.notification.update({ where: { id }, data: { isRead: true } });
  },

  async markAllRead(userId: string) {
    await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
    return { message: "All notifications marked as read" };
  },

  async unreadCount(userId: string) {
    const count = await prisma.notification.count({ where: { userId, isRead: false } });
    return { count };
  },
};

const router = Router();
router.use(authenticate);

router.get(
  "/",
  validate({ query: listQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const page = getPageParams(req);
    const unreadOnly = req.query.unreadOnly as string | undefined;
    const { items, total } = await notificationsService.list(req.user.sub, { ...page, unreadOnly });
    sendSuccess(res, 200, { data: items, pagination: paginationMeta(page.page, page.limit, total) });
  })
);

router.get(
  "/unread-count",
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await notificationsService.unreadCount(req.user.sub) });
  })
);

router.post(
  "/:id/read",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await notificationsService.markRead(req.user.sub, req.params.id) });
  })
);

router.post(
  "/mark-all-read",
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    sendSuccess(res, 200, { data: await notificationsService.markAllRead(req.user.sub) });
  })
);

export default router;
