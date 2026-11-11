import { Router } from "express";
import { validate } from "@common/middleware/validate";
import { authenticate } from "@common/middleware/authenticate";
import { loginRateLimiter, forgotPasswordRateLimiter, resetPasswordRateLimiter } from "@common/middleware/rateLimiter";
import { authController } from "./auth.controller";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  resetPasswordSchema,
  verifyResetTokenSchema,
} from "./auth.validators";

const router = Router();

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login with email + password
 *     security: []
 *     requestBody:
 *       required: true
 *     responses:
 *       200: { description: OK }
 *       401: { description: Invalid credentials }
 *       423: { description: Account locked }
 */
router.post("/login", loginRateLimiter, validate({ body: loginSchema }), authController.login);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange a refresh token for a new access/refresh token pair
 *     security: []
 *     responses:
 *       200: { description: OK }
 */
router.post("/refresh", validate({ body: refreshSchema }), authController.refresh);

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request a password reset token
 *     security: []
 *     responses:
 *       200: { description: OK }
 */
router.post(
  "/forgot-password",
  forgotPasswordRateLimiter,
  validate({ body: forgotPasswordSchema }),
  authController.forgotPassword
);

/**
 * @openapi
 * /auth/verify-reset-token:
 *   get:
 *     tags: [Auth]
 *     summary: Verify whether a reset token is valid and unexpired
 *     security: []
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Token is valid }
 *       401: { description: Invalid or expired token }
 *   post:
 *     tags: [Auth]
 *     summary: Verify whether a reset token is valid and unexpired
 *     security: []
 *     responses:
 *       200: { description: Token is valid }
 *       401: { description: Invalid or expired token }
 */
router.get("/verify-reset-token", validate({ query: verifyResetTokenSchema }), authController.verifyResetToken);
router.post("/verify-reset-token", validate({ body: verifyResetTokenSchema }), authController.verifyResetToken);

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password using a signed reset token
 *     security: []
 *     responses:
 *       200: { description: OK }
 */
router.post("/reset-password", resetPasswordRateLimiter, validate({ body: resetPasswordSchema }), authController.resetPassword);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout — blacklists access token and revokes refresh token
 *     responses:
 *       200: { description: OK }
 */
router.post("/logout", authenticate, authController.logout);

/**
 * @openapi
 * /auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Change password for the logged-in user
 *     responses:
 *       200: { description: OK }
 */
router.post("/change-password", authenticate, validate({ body: changePasswordSchema }), authController.changePassword);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get the current authenticated user's profile
 *     responses:
 *       200: { description: OK }
 */
router.get("/me", authenticate, authController.me);

export default router;
