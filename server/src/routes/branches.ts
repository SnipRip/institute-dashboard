import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { hasPermission, requireAuth } from "../middleware/auth.js";

const BranchSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  is_active: z.boolean().optional().default(true),
  is_default: z.boolean().optional().default(false),
  business_modules: z.record(z.string(), z.unknown()).optional().nullable(),
});

function normalizeString(value: string | null | undefined) {
  const v = (value ?? "").trim();
  return v ? v : null;
}

export async function registerBranchRoutes(app: FastifyInstance) {
  app.get("/branches", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const pool = getPool();
    const canManage = hasPermission(auth.user, "branches.manage");
    const res = await pool.query(
      canManage
        ? `select id, name, code, address, phone, email, is_active, is_default, business_modules, created_at, updated_at
           from branches
           order by is_default desc, name asc`
        : `select b.id, b.name, b.code, b.address, b.phone, b.email, b.is_active, b.is_default, b.business_modules, b.created_at, b.updated_at
           from user_branch_access uba
           join branches b on b.id = uba.branch_id
           where uba.user_id = $1
             and uba.is_active = true
             and b.is_active = true
           order by b.is_default desc, b.name asc`,
      canManage ? [] : [auth.user.id],
    );
    return reply.send({ branches: res.rows });
  });

  app.post("/branches", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });
    if (!hasPermission(auth.user, "branches.manage")) return reply.code(403).send({ message: "Forbidden" });

    const parsed = BranchSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });

    const pool = getPool();
    const data = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("begin");
      if (data.is_default) {
        await client.query(`update branches set is_default = false where is_default = true`);
      }

      const created = await client.query(
        `insert into branches (name, code, address, phone, email, is_active, is_default, business_modules)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         returning id, name, code, address, phone, email, is_active, is_default, business_modules, created_at, updated_at`,
        [
          data.name.trim(),
          normalizeString(data.code),
          normalizeString(data.address),
          normalizeString(data.phone),
          normalizeString(data.email),
          data.is_active,
          data.is_default,
          data.business_modules ? JSON.stringify(data.business_modules) : null,
        ],
      );

      const role = await client.query(`select id from roles where name = $1 limit 1`, [auth.user.role || "owner"]);
      const fallbackRole = await client.query(`select id from roles where name = 'owner' limit 1`);
      const roleId = role.rows[0]?.id ?? fallbackRole.rows[0]?.id;
      if (roleId && auth.user.id !== "dev-admin") {
        await client.query(
          `insert into user_branch_access (user_id, branch_id, role_id, is_active)
           values ($1, $2, $3, true)
           on conflict (user_id, branch_id)
           do update set role_id = excluded.role_id, is_active = true, updated_at = now()`,
          [auth.user.id, created.rows[0].id, roleId],
        );
      }

      await client.query("commit");
      return reply.code(201).send({ branch: created.rows[0] });
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  });

  app.put("/branches/:id", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });
    if (!hasPermission(auth.user, "branches.manage")) return reply.code(403).send({ message: "Forbidden" });

    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid params", errors: params.error.issues });
    const parsed = BranchSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });

    const pool = getPool();
    const data = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("begin");
      if (data.is_default) await client.query(`update branches set is_default = false where id <> $1`, [params.data.id]);
      const updated = await client.query(
        `update branches
         set name = $2,
             code = $3,
             address = $4,
             phone = $5,
             email = $6,
             is_active = $7,
             is_default = $8,
             business_modules = $9::jsonb,
             updated_at = now()
         where id = $1
         returning id, name, code, address, phone, email, is_active, is_default, business_modules, created_at, updated_at`,
        [
          params.data.id,
          data.name.trim(),
          normalizeString(data.code),
          normalizeString(data.address),
          normalizeString(data.phone),
          normalizeString(data.email),
          data.is_active,
          data.is_default,
          data.business_modules ? JSON.stringify(data.business_modules) : null,
        ],
      );
      if (!updated.rows[0]) {
        await client.query("rollback");
        return reply.code(404).send({ message: "Branch not found" });
      }
      await client.query("commit");
      return reply.send({ branch: updated.rows[0] });
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  });
}
