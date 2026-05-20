import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { getEnv } from "./env.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAccountingRoutes } from "./routes/accounting.js";
import { registerBranchRoutes } from "./routes/branches.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerClassRoutes } from "./routes/classes.js";
import { registerCompanyRoutes } from "./routes/company.js";
import { registerPurchaseRoutes } from "./routes/purchases.js";
import { registerLibraryRoutes } from "./routes/library.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerReceiptRoutes } from "./routes/receipts.js";
import { registerRoleRoutes } from "./routes/roles.js";
import { registerStudentRoutes } from "./routes/students.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerStaffRoutes } from "./routes/staff.js";

const env = getEnv();

const app = Fastify({ logger: true });

const uploadsRoot = path.resolve(process.cwd(), "Uploads");
if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });

await app.register(cors, {
  origin: env.CORS_ORIGIN,
  credentials: true,
});

await app.register(multipart, {
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

await app.register(fastifyStatic, {
  root: uploadsRoot,
  prefix: "/uploads/",
});

app.get("/health", async () => ({ ok: true }));

await registerAuthRoutes(app);
await registerAccountingRoutes(app);
await registerBranchRoutes(app);
await registerBillingRoutes(app);
await registerClassRoutes(app);
await registerCompanyRoutes(app);
await registerPurchaseRoutes(app);
await registerLibraryRoutes(app);
await registerReportRoutes(app);
await registerReceiptRoutes(app);
await registerRoleRoutes(app);
await registerStudentRoutes(app);
await registerUserRoutes(app);
await registerStaffRoutes(app);

app.listen({ port: env.PORT, host: "0.0.0.0" });
