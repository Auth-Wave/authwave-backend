import { Router } from "express";
import {
  createAccount,
  createLoginSession,
  deleteAccount,
  deleteLoginSession,
  getUserFromConsole,
  refreshAccessToken,
  verifyUserFromConsole,
} from "../controllers/admin.controller";
import { authenticateAdmin } from "../middlewares/admin-auth";
import { validateProject } from "../middlewares/validate-project";
import {
  createAccount as createUserAccount,
  deleteAccount as deleteUserAccount,
  getAllLoginSessions as getAllUserLoginSessions,
  deleteLoginSessionByID as deleteUserLoginSession,
  deleteAllLoginSessions as deleteAllUserLoginSessions,
} from "../controllers/user.controller";

const router = Router();

router.route("/account/create").post(createAccount);
router.route("/account/login").post(createLoginSession);
router.route("/account/logout").put(authenticateAdmin, deleteLoginSession);
router.route("/account/delete").delete(authenticateAdmin, deleteAccount);

router.route("/access-token/refresh").post(refreshAccessToken);

// CONSOLE RELATED ENDPOINTS
router
  .route("/get-user/:userId")
  .get(authenticateAdmin, validateProject, getUserFromConsole);
router
  .route("/verify-user")
  .put(authenticateAdmin, validateProject, verifyUserFromConsole);
router
  .route("/create-user")
  .post(authenticateAdmin, validateProject, createUserAccount);
router
  .route("/delete-user/:userId")
  .delete(authenticateAdmin, validateProject, deleteUserAccount);
router
  .route("/get-user-sessions/:userId")
  .get(authenticateAdmin, validateProject, getAllUserLoginSessions);
router
  .route("/delete-user-session/:sessionId")
  .delete(authenticateAdmin, validateProject, deleteUserLoginSession);
router
  .route("/clear-user-sessions/:userId")
  .delete(authenticateAdmin, validateProject, deleteAllUserLoginSessions);

export const adminRouter = router;
