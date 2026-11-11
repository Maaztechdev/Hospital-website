import { Router, type Response, type NextFunction } from "express";
import path from "node:path";
import { authenticate } from "@common/middleware/authenticate";
import { resolvePrivateFile } from "@common/utils/privateFiles";
import { NotFoundError } from "@common/errors/AppError";

const router = Router();

function sendSecureFile(res: Response, target: string, next: NextFunction) {
  const ext = path.extname(target).toLowerCase();
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Prevent any script execution or origin escalation from rendered files
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");

  // Force download for active/XML/SVG content so it cannot execute in the browser DOM
  if (ext === ".svg" || ext === ".html" || ext === ".htm" || ext === ".xml" || ext === ".xhtml") {
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(target)}"`);
  }

  res.sendFile(target, { dotfiles: "deny" }, (error) => {
    if (error) next(error);
  });
}

const ALLOWED_PUBLIC_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".ico", ".svg"]);

function assertAllowedPublicImage(subpath: string) {
  if (!subpath || subpath.endsWith("/")) throw new NotFoundError("File not found");
  const ext = path.extname(subpath).toLowerCase();
  if (!ALLOWED_PUBLIC_EXTENSIONS.has(ext)) {
    throw new NotFoundError("File not found");
  }
}

router.get("/hospital-profile/*", (req, res, next) => {
  try {
    const subpath = (req.params as Record<string, string>)["0"] ?? "";
    assertAllowedPublicImage(subpath);
    const target = resolvePrivateFile(`hospital-profile/${subpath}`);
    sendSecureFile(res, target, next);
  } catch (error) { next(error); }
});

router.get("/pharmacy-profile/*", (req, res, next) => {
  try {
    const subpath = (req.params as Record<string, string>)["0"] ?? "";
    assertAllowedPublicImage(subpath);
    const target = resolvePrivateFile(`pharmacy-profile/${subpath}`);
    sendSecureFile(res, target, next);
  } catch (error) { next(error); }
});

router.get("/public-profile-pictures/*", (req, res, next) => {
  try {
    const subpath = (req.params as Record<string, string>)["0"] ?? "";
    assertAllowedPublicImage(subpath);
    const target = resolvePrivateFile(`public-profile-pictures/${subpath}`);
    sendSecureFile(res, target, next);
  } catch (error) { next(error); }
});

router.get("/*", authenticate, (req, res, next) => {
  try {
    const target = resolvePrivateFile(req.params[0]);
    sendSecureFile(res, target, next);
  } catch (error) { next(error); }
});

export default router;
