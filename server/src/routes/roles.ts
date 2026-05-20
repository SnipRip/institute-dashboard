import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { hasPermission, requireAuth } from "../middleware/auth.js";

const RoleSchema = z.object({
  name: z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/),
  description: z.string().trim().max(300).optional().nullable(),
  permissions: z.array(z.string().min(1)).optional().default([]),
});

export async function registerRoleRoutes(app: FastifyInstance) {
  app.get("/permissions", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });
    if (!hasPermission(auth.user, "roles.manage") && !hasPermission(auth.user, "users.manage")) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const pool = getPool();
    const res = await pool.query(
      `select code, label, module
       from permissions
       order by module asc, code asc`,
    );
    return reply.send({ permissions: res.rows });
  });

  app.get("/roles", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });
    if (!hasPermission(auth.user, "roles.manage") && !hasPermission(auth.user, "users.manage")) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const pool = getPool();
    const res = await pool.query(
      `select
         r.id,
         r.name,
         r.description,
         r.is_system,
         r.created_at,
         r.updated_at,
         coalesce(
           array_agg(rp.permission_code order by rp.permission_code)
             filter (where rp.permission_code is not null),
           '{}'::text[]
         ) as permissions
       from roles r
       left join role_permissions rp on rp.role_id = r.id
       group by r.id
       order by r.is_system desc, r.name asc`,
    );
    return reply.send({ roles: res.rows });
  });

  app.post("/roles", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });
    if (!hasPermission(auth.user, "roles.manage")) return reply.code(403).send({ message: "Forbidden" });

    const parsed = RoleSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });

    const pool = getPool();
    const data = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("begin");
      const roleRes = await client.query(
        `insert into roles (name, description, is_system)
         values ($1, $2, false)
         returning id, name, description, is_system, created_at, updated_at`,
        [data.name, data.description ?? null],
      );
      for (const permission of data.permissions) {
        await client.query(
          `insert into role_permissions (role_id, permission_code)
           values ($1, $2)
           on conflict do nothing`,
          [roleRes.rows[0].id, permission],
        );
      }
      await client.query("commit");
      return reply.code(201).send({ role: { ...roleRes.rows[0], permissions: data.permissions } });
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  });

  app.put("/roles/:id", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });
    if (!hasPermission(auth.user, "roles.manage")) return reply.code(403).send({ message: "Forbidden" });

    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ message: "Invalid params", errors: params.error.issues });
    const parsed = RoleSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });

    const pool = getPool();
    const data = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("begin");
      const roleRes = await client.query(
        `update roles
         set name = case when is_system then name else $2 end,
             description = $3,
             updated_at = now()
         where id = $1
         returning id, name, description, is_system, created_at, updated_at`,
        [params.data.id, data.name, data.description ?? null],
      );
      if (!roleRes.rows[0]) {
        await client.query("rollback");
        return reply.code(404).send({ message: "Role not found" });
      }
      await client.query(`delete from role_permissions where role_id = $1`, [params.data.id]);
      for (const permission of data.permissions) {
        await client.query(
          `insert into role_permissions (role_id, permission_code)
           values ($1, $2)
           on conflict do nothing`,
          [params.data.id, permission],
        );
      }
      await client.query("commit");
      return reply.send({ role: { ...roleRes.rows[0], permissions: data.permissions } });
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  });
}
