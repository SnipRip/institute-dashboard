import type { FastifyRequest } from "fastify";
import { getEnv } from "../env.js";
import { getUserBySessionToken, type SessionUser } from "../auth/sessions.js";

const DEV_ADMIN_TOKEN = "dev-admin-token";
const DEV_ADMIN_USER: SessionUser = {
  id: "dev-admin",
  username: "admin",
  role: "admin",
  roleId: null,
  branchId: null,
  branchName: null,
  permissions: ["*"],
};

export async function requireAuth(req: FastifyRequest) {
  const env = getEnv();

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return { ok: false as const, status: 401 };

  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false as const, status: 401 };

  // Optional dev shortcut (kept for backwards compatibility)
  if (process.env.NODE_ENV !== "production" && env.ENABLE_DEV_AUTH && token === DEV_ADMIN_TOKEN) {
    return { ok: true as const, user: DEV_ADMIN_USER };
  }

  const user = await getUserBySessionToken(token);
  if (!user) return { ok: false as const, status: 401 };
  return { ok: true as const, user };
}

export function hasPermission(user: SessionUser, permission: string) {
  return user.role === "owner" || user.role === "admin" || user.permissions.includes("*") || user.permissions.includes(permission);
}

export async function requirePermission(req: FastifyRequest, permission: string) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth;
  if (!hasPermission(auth.user, permission)) return { ok: false as const, status: 403 };
  return auth;
}

export function requireBranchId(user: SessionUser) {
  return user.branchId;
}
