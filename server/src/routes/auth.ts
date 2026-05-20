import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEnv } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { getPool } from "../db/pool.js";
import { createSession, generateToken } from "../auth/sessions.js";

const DEV_ADMIN_USERNAME = "admin";
const DEV_ADMIN_PASSWORD = "Feelpain@1";
const DEV_ADMIN_TOKEN = "dev-admin-token";

const LoginSchema = z.object({
  email: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  identifier: z.string().min(1).optional(),
  password: z.string().min(1),
  branchId: z.string().uuid().optional().nullable(),
});

function pickIdentifier(body: z.infer<typeof LoginSchema>) {
  return body.identifier ?? body.email ?? body.username ?? "";
}

async function getAccessibleBranches(userId: string) {
  const pool = getPool();
  const res = await pool.query(
    `select
       b.id,
       b.name,
       b.code,
       b.is_default,
       r.id as role_id,
       r.name as role,
       coalesce(
         array_agg(rp.permission_code order by rp.permission_code)
           filter (where rp.permission_code is not null),
         '{}'::text[]
       ) as permissions
     from user_branch_access uba
     join branches b on b.id = uba.branch_id
     join roles r on r.id = uba.role_id
     left join role_permissions rp on rp.role_id = r.id
     where uba.user_id = $1
       and uba.is_active = true
       and b.is_active = true
     group by b.id, b.name, b.code, b.is_default, r.id, r.name
     order by b.is_default desc, b.name asc`,
    [userId],
  );
  return res.rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    code: r.code ? String(r.code) : null,
    isDefault: Boolean(r.is_default),
    roleId: String(r.role_id),
    role: String(r.role),
    permissions: Array.isArray(r.permissions) ? (r.permissions as string[]) : [],
  }));
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (req, reply) => {
    const env = getEnv();

    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const identifier = pickIdentifier(parsed.data);
    const { password } = parsed.data;

    // Optional legacy dev shortcut (kept for convenience)
    if (process.env.NODE_ENV !== "production" && env.ENABLE_DEV_AUTH) {
      if (identifier === DEV_ADMIN_USERNAME && password === DEV_ADMIN_PASSWORD) {
        return reply.send({
          token: DEV_ADMIN_TOKEN,
          user: {
            id: "dev-admin",
            username: DEV_ADMIN_USERNAME,
            role: "admin",
          },
        });
      }
    }

    const pool = getPool();
    const result = await pool.query(
      `select
         id,
         username,
         role,
         is_active,
         (password_hash = crypt($2, password_hash)) as password_ok
       from users
       where (username = $1 or email = $1)
         and deleted_at is null
       limit 1`,
      [identifier, password],
    );

    const row = result.rows[0] as
      | { id: string; username: string; role: string; is_active: boolean; password_ok: boolean }
      | undefined;

    if (!row) return reply.code(401).send({ message: "Invalid credentials" });
    if (!row.password_ok) return reply.code(401).send({ message: "Invalid credentials" });
    if (!row.is_active) return reply.code(403).send({ message: "Your account is inactive. Contact an admin." });

    const branches = await getAccessibleBranches(row.id);
    if (branches.length === 0) {
      return reply.code(403).send({ message: "No branch access assigned. Contact an admin." });
    }

    const requestedBranchId = parsed.data.branchId ?? null;
    const selectedBranch = requestedBranchId
      ? branches.find((b) => b.id === requestedBranchId)
      : branches.length === 1
        ? branches[0]
        : null;

    const baseUser = { id: row.id, username: row.username, role: selectedBranch?.role ?? row.role };

    if (requestedBranchId && !selectedBranch) {
      return reply.code(403).send({ message: "You do not have access to this branch." });
    }

    if (!selectedBranch) {
      return reply.send({
        requiresBranchSelection: true,
        user: baseUser,
        branches,
      });
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await createSession(row.id, token, expiresAt, selectedBranch.id);

    return reply.send({
      token,
      user: { ...baseUser, role: selectedBranch.role },
      branch: selectedBranch,
      branches,
      permissions: selectedBranch.permissions,
    });
  });

  app.get("/me", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });
    const branches = auth.user.id === "dev-admin" ? [] : await getAccessibleBranches(auth.user.id);
    return reply.send({ ...auth.user, branches });
  });
}
