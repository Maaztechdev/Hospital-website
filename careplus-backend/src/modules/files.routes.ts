import { Router } from "express";
import { authenticate } from "@common/middleware/authenticate";
import { resolvePrivateFile } from "@common/utils/privateFiles";

const router = Router();
router.get("/hospital-profile/*", (req, res, next) => {
  try {
    const target = resolvePrivateFile(`hospital-profile/${(req.params as Record<string, string>)["0"]}`);
    res.sendFile(target, { dotfiles: "deny" }, (error) => { if (error) next(error); });
  } catch (error) { next(error); }
});
router.get("/*", authenticate, (req, res, next) => {
  try {
    const target = resolvePrivateFile(req.params[0]);
    res.sendFile(target, { dotfiles: "deny" }, (error) => { if (error) next(error); });
  } catch (error) { next(error); }
});
export default router;