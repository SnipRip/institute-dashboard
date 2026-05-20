import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { getPool } from "../db/pool.js";

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function isValidUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export async function registerStaffRoutes(app: FastifyInstance) {
  const StaffSchema = z.object({
    user_id: z.string().uuid().optional().nullable(),
    display_name: z.string().trim().min(1).max(200),
    designation: z.string().trim().max(200).optional().nullable(),
    phone: z.string().trim().max(50).optional().nullable(),
    email: z.string().trim().max(200).optional().nullable(),
    is_active: z.boolean().optional().default(true),
  });

  app.get("/staff", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });
    if (auth.user.role !== "admin" && auth.user.role !== "owner") {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const pool = getPool();
    const result = await pool.query(
      `select
         s.id,
         s.user_id,
         s.display_name,
         s.designation,
         s.phone,
         s.email,
         s.is_active,
         s.created_at,
         s.updated_at,
         u.username as linked_username,
         u.role as linked_role
       from staff s
       left join users u on u.id = s.user_id
       order by s.display_name asc, s.created_at desc`
    );

    return reply.send({ staff: result.rows });
  });

  app.post("/staff", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });
    if (auth.user.role !== "admin" && auth.user.role !== "owner") {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const parsed = StaffSchema.safeParse((req.body ?? {}) as unknown);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const userId = parsed.data.user_id && isValidUuid(parsed.data.user_id) ? parsed.data.user_id : null;
    const designation = normalizeOptionalString(parsed.data.designation);
    const phone = normalizeOptionalString(parsed.data.phone);
    const email = normalizeOptionalString(parsed.data.email);

    const pool = getPool();
    try {
      const created = await pool.query(
        `insert into staff (user_id, display_name, designation, phone, email, is_active)
         values ($1, $2, $3, $4, $5, $6)
         returning id, user_id, display_name, designation, phone, email, is_active, created_at, updated_at`,
        [userId, parsed.data.display_name.trim(), designation, phone, email, parsed.data.is_active]
      );

      return reply.code(201).send({ staff: created.rows[0] });
    } catch (err: any) {
      if (err?.code === "23505" && String(err?.constraint ?? "").includes("staff_user_id")) {
        return reply.code(400).send({ message: "This user is already linked to a staff record" });
      }
      throw err;
    }
  });

  app.put("/staff/:id", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });
    if (auth.user.role !== "admin" && auth.user.role !== "owner") {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const { id } = req.params as { id: string };
    if (!isValidUuid(id)) return reply.code(400).send({ message: "Invalid staff id" });

    const parsed = StaffSchema.safeParse((req.body ?? {}) as unknown);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const userId = parsed.data.user_id && isValidUuid(parsed.data.user_id) ? parsed.data.user_id : null;
    const designation = normalizeOptionalString(parsed.data.designation);
    const phone = normalizeOptionalString(parsed.data.phone);
    const email = normalizeOptionalString(parsed.data.email);

    const pool = getPool();
    try {
      const updated = await pool.query(
        `update staff
         set user_id = $2,
             display_name = $3,
             designation = $4,
             phone = $5,
             email = $6,
             is_active = $7,
             updated_at = now()
         where id = $1
         returning id, user_id, display_name, designation, phone, email, is_active, created_at, updated_at`,
        [id, userId, parsed.data.display_name.trim(), designation, phone, email, parsed.data.is_active]
      );

      if (updated.rowCount === 0) return reply.code(404).send({ message: "Not found" });
      return reply.send({ staff: updated.rows[0] });
    } catch (err: any) {
      if (err?.code === "23505" && String(err?.constraint ?? "").includes("staff_user_id")) {
        return reply.code(400).send({ message: "This user is already linked to a staff record" });
      }
      throw err;
    }
  });
}
