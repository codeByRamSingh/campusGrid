import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { collegeRouter } from "./college.routes.js";
import { courseRouter } from "./course.routes.js";
import { rolesRouter } from "./roles.routes.js";
import { usersRouter } from "./users.routes.js";

export const adminRouter = Router();

// All admin routes require authentication
adminRouter.use(authenticate);

// Mount domain subrouters — all paths remain under /admin/*
adminRouter.use("/admin", collegeRouter);
adminRouter.use("/admin", courseRouter);
adminRouter.use("/admin", rolesRouter);
adminRouter.use("/admin", usersRouter);
