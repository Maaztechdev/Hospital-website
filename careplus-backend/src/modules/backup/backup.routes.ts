import { Request, Response, Router } from "express";
import { z } from "zod";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess } from "@common/utils/apiResponse";
import { UnauthorizedError } from "@common/errors/AppError";
import { backupService } from "./backup.service";

const idSchema = z.object({ id: z.string().uuid() });
const restoreSchema = z.object({ password: z.string().min(1) });
const router = Router();
router.use(authenticate, requireRole(["ADMIN"]));

router.post("/", asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  sendSuccess(res, 201, { data: await backupService.create(req.user.sub, req) });
}));
router.get("/", asyncHandler(async (_req, res) => sendSuccess(res, 200, { data: await backupService.list() })));
router.get("/:id/download", validate({ params: idSchema }), asyncHandler(async (req, res) => {
  const { record, target } = await backupService.download(req.params.id);
  res.download(target, record.filename);
}));
router.delete("/:id", validate({ params: idSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  await backupService.remove(req.params.id, req.user.sub, req);
  sendSuccess(res, 200, { message: "Backup deleted" });
}));
router.post("/:id/restore", validate({ params: idSchema, body: restoreSchema }), asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  await backupService.restore(req.params.id, req.body.password, req.user.sub, req);
  sendSuccess(res, 200, { message: "Database restored successfully" });
}));

export default router;
