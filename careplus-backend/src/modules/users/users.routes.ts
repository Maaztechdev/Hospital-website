import { Router } from "express";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { usersController } from "./users.controller";
import { createUserSchema, idParamSchema, listUsersQuerySchema, updateUserSchema } from "./users.validators";

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: List users (admin only)
 *     responses:
 *       200: { description: OK }
 */
router.get("/", requireRole(["ADMIN"]), validate({ query: listUsersQuerySchema }), usersController.list);

router.get("/:id", requireRole(["ADMIN"]), validate({ params: idParamSchema }), usersController.getById);

/**
 * @openapi
 * /users:
 *   post:
 *     tags: [Users]
 *     summary: Create a user (admin-only registration — no public signup)
 *     responses:
 *       201: { description: Created }
 */
router.post("/", requireRole(["ADMIN"]), validate({ body: createUserSchema }), usersController.create);

router.patch(
  "/:id",
  requireRole(["ADMIN"]),
  validate({ params: idParamSchema, body: updateUserSchema }),
  usersController.update
);

/**
 * @openapi
 * /users/{id}/deactivate:
 *   post:
 *     tags: [Users]
 *     summary: Deactivate a user (admin only, no self-deactivation)
 *     responses:
 *       200: { description: OK }
 */
router.post("/:id/deactivate", requireRole(["ADMIN"]), validate({ params: idParamSchema }), usersController.deactivate);

export default router;
