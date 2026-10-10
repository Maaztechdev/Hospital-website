import { Router } from "express";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { usersController } from "./users.controller";
import { createUserSchema, idParamSchema, listUsersQuerySchema, updateUserSchema } from "./users.validators";
import multer from "multer";

const router = Router();

router.use(authenticate);
const profileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 3 },
  fileFilter: (_req, file, callback) => callback(null, ["image/jpeg", "image/png"].includes(file.mimetype)),
});

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
router.get("/ultrasound-staff", requireRole(["ADMIN", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "RADIOLOGIST"]), usersController.listUltrasoundStaff);

router.get("/me/profile", (req, _res, next) => { if (req.user) req.params.id = req.user.sub; next(); }, usersController.getProfile);
router.patch("/me/profile", profileUpload.fields([{ name: "profilePicture", maxCount: 1 }, { name: "signature", maxCount: 1 }, { name: "stamp", maxCount: 1 }]), (req, _res, next) => { if (req.user) req.params.id = req.user.sub; next(); }, usersController.updateProfile);

router.get("/:id", requireRole(["ADMIN"]), validate({ params: idParamSchema }), usersController.getById);
router.get("/:id/profile", requireRole(["ADMIN", "RECEPTIONIST", "DOCTOR", "LAB_TECHNICIAN", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "RADIOLOGIST", "PHARMACIST", "NURSE"]), validate({ params: idParamSchema }), usersController.getProfile);
router.patch("/:id/profile", requireRole(["ADMIN"]), profileUpload.fields([{ name: "profilePicture", maxCount: 1 }, { name: "signature", maxCount: 1 }, { name: "stamp", maxCount: 1 }]), validate({ params: idParamSchema }), usersController.updateProfile);

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
