import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import path from "node:path";
import fs from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const WeeklyScheduleEntrySchema = z
  .object({
    // 0=Mon ... 6=Sun
    day_of_week: z.number().int().min(0).max(6),
    is_off: z.boolean().optional().default(false),
    start_time: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
    end_time: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.is_off) {
      if (val.start_time != null || val.end_time != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "When is_off is true, start_time/end_time must be null",
        });
      }
      return;
    }

    if (!val.start_time || !val.end_time) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "start_time and end_time are required when is_off is false",
      });
      return;
    }

    if (val.start_time >= val.end_time) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "start_time must be earlier than end_time",
      });
    }
  });

const CreateClassSchema = z.object({
  name: z.string().min(1),
  monthly_fee: z.number().int().min(0).optional().default(0),
  short_description: z.string().optional().nullable(),
  class_timing: z.string().optional().nullable(),
  schedule: z
    .array(WeeklyScheduleEntrySchema)
    .optional()
    .default([])
    .superRefine((val, ctx) => {
      const days = new Set<number>();
      for (const e of val) {
        if (days.has(e.day_of_week)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Duplicate day_of_week in schedule",
          });
          return;
        }
        days.add(e.day_of_week);
      }
    }),
  status: z.string().optional().default("active"),
});

const UpdateClassSchema = z.object({
  name: z.string().min(1).optional(),
  monthly_fee: z.number().int().min(0).optional(),
  short_description: z.string().optional().nullable(),
  class_timing: z.string().optional().nullable(),
  schedule: z
    .array(WeeklyScheduleEntrySchema)
    .optional()
    .superRefine((val, ctx) => {
      if (!val) return;
      const days = new Set<number>();
      for (const e of val) {
        if (days.has(e.day_of_week)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Duplicate day_of_week in schedule",
          });
          return;
        }
        days.add(e.day_of_week);
      }
    }),
  status: z.string().optional(),
});

const CreateSubjectSchema = z.object({
  name: z.string().min(1).max(120),
});

const CreateTopicSchema = z.object({
  name: z.string().min(1).max(160),
});

const CreateTopicPartSchema = z.object({
  name: z.string().min(1).max(160),
});

const ToggleCompletedSchema = z.object({
  is_completed: z.boolean(),
});

const CreateMaterialSchema = z.object({
  title: z.string().min(1).max(200),
  url: z.string().url(),
  description: z.string().max(2000).optional().nullable(),
  thumbnail_url: z.string().url().optional().nullable(),
});

const ReorderIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "subject";
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extFromMime(mime: string | undefined): string {
  const m = (mime || "").toLowerCase();
  if (m === "image/jpeg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  return "";
}

function uploadsRoot() {
  return path.resolve(process.cwd(), "Uploads");
}

export async function registerClassRoutes(app: FastifyInstance) {
  app.get("/classes", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const pool = getPool();
    const result = await pool.query(
      `select
         c.id,
         c.name,
         c.monthly_fee,
         c.short_description,
         c.class_timing,
         c.thumbnail_url,
         c.banner_url,
         c.status,
         c.created_at,
         c.updated_at,
         coalesce(
           (
             select json_agg(
               json_build_object(
                 'day_of_week', s.day_of_week,
                 'is_off', s.is_off,
                 'start_time', case when s.start_time is null then null else to_char(s.start_time, 'HH24:MI') end,
                 'end_time', case when s.end_time is null then null else to_char(s.end_time, 'HH24:MI') end
               )
               order by s.day_of_week
             )
             from class_weekly_schedule s
             where s.class_id = c.id
           ),
           '[]'::json
       ) as schedule
       from classes c
       where ($1::uuid is null or c.branch_id = $1::uuid)
       order by c.created_at desc`,
      [auth.user.branchId],
    );
    return reply.send(result.rows);
  });

  app.get("/classes/:id", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const pool = getPool();
    const { id } = req.params as { id: string };
    const result = await pool.query(
      `select
         c.id,
         c.name,
         c.monthly_fee,
         c.short_description,
         c.class_timing,
         c.thumbnail_url,
         c.banner_url,
         c.status,
         c.created_at,
         c.updated_at,
         coalesce(
           (
             select json_agg(
               json_build_object(
                 'day_of_week', s.day_of_week,
                 'is_off', s.is_off,
                 'start_time', case when s.start_time is null then null else to_char(s.start_time, 'HH24:MI') end,
                 'end_time', case when s.end_time is null then null else to_char(s.end_time, 'HH24:MI') end
               )
               order by s.day_of_week
             )
             from class_weekly_schedule s
             where s.class_id = c.id
           ),
           '[]'::json
         ) as schedule
       from classes c
       where c.id = $1
         and ($2::uuid is null or c.branch_id = $2::uuid)
       limit 1`,
      [id, auth.user.branchId],
    );

    const row = result.rows[0];
    if (!row) return reply.code(404).send({ message: "Not found" });
    return reply.send(row);
  });

  app.get("/classes/:id/subjects", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const pool = getPool();
    const { id } = req.params as { id: string };

    const existing = await pool.query(`select id from classes where id = $1 and ($2::uuid is null or branch_id = $2::uuid) limit 1`, [id, auth.user.branchId]);
    if (!existing.rows[0]) return reply.code(404).send({ message: "Not found" });

    const result = await pool.query(
      `select id, class_id, name, slug, position, created_at, updated_at
       from class_subjects
       where class_id = $1
       order by position asc, created_at asc`,
      [id],
    );

    return reply.send(result.rows);
  });

  app.get("/classes/:id/subjects/:subjectId", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const pool = getPool();
    const { id, subjectId } = req.params as { id: string; subjectId: string };

    const result = await pool.query(
      `select id, class_id, name, slug, position, created_at, updated_at
       from class_subjects
       where class_id = $1 and id = $2
       limit 1`,
      [id, subjectId],
    );

    const row = result.rows[0];
    if (!row) return reply.code(404).send({ message: "Not found" });
    return reply.send(row);
  });

  app.post("/classes/:id/subjects", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const { id } = req.params as { id: string };
    const parsed = CreateSubjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const pool = getPool();
    const existing = await pool.query(`select id from classes where id = $1 and ($2::uuid is null or branch_id = $2::uuid) limit 1`, [id, auth.user.branchId]);
    if (!existing.rows[0]) return reply.code(404).send({ message: "Not found" });

    const name = parsed.data.name.trim();
    const base = slugify(name);

    // Ensure unique slug per class (unique (class_id, slug))
    const candidates = await pool.query(
      `select slug
       from class_subjects
       where class_id = $1
         and (slug = $2 or slug like $2 || '-%')`,
      [id, base],
    );

    let slug = base;
    const hasBase = candidates.rows.some((r) => r.slug === base);
    if (hasBase) {
      let maxSuffix = 1;
      const re = new RegExp(`^${escapeRegExp(base)}-(\\d+)$`);
      for (const r of candidates.rows as Array<{ slug: string }>) {
        const m = r.slug.match(re);
        if (m) {
          const n = Number(m[1]);
          if (Number.isFinite(n)) maxSuffix = Math.max(maxSuffix, n);
        }
      }
      slug = `${base}-${maxSuffix + 1}`;
    }

    const nextPosRes = await pool.query(
      `select coalesce(max(position), -1) as max_pos
       from class_subjects
       where class_id = $1`,
      [id],
    );
    const nextPosition = Number(nextPosRes.rows[0]?.max_pos ?? -1) + 1;

    const created = await pool.query(
      `insert into class_subjects (class_id, name, slug, position)
       values ($1, $2, $3, $4)
       returning id, class_id, name, slug, position, created_at, updated_at`,
      [id, name, slug, nextPosition],
    );

    return reply.code(201).send(created.rows[0]);
  });

  app.delete("/classes/:id/subjects/:subjectId", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const pool = getPool();
    const { id, subjectId } = req.params as { id: string; subjectId: string };

    const existing = await pool.query(
      `select id from class_subjects where class_id = $1 and id = $2 limit 1`,
      [id, subjectId],
    );
    if (!existing.rows[0]) return reply.code(404).send({ message: "Not found" });

    await pool.query(`delete from class_subjects where id = $1`, [subjectId]);
    return reply.code(204).send();
  });

  app.patch("/classes/:id/subjects/reorder", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const parsed = ReorderIdsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const pool = getPool();
    const { id } = req.params as { id: string };
    const ids = parsed.data.ids;

    const found = await pool.query(
      `select id from class_subjects where class_id = $1 and id = any($2::uuid[])`,
      [id, ids],
    );
    if (found.rowCount !== ids.length) {
      return reply.code(400).send({ message: "Some subjects do not belong to this class" });
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      for (let i = 0; i < ids.length; i++) {
        await client.query(
          `update class_subjects
           set position = $2,
               updated_at = now()
           where id = $1`,
          [ids[i], i],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }

    const result = await pool.query(
      `select id, class_id, name, slug, position, created_at, updated_at
       from class_subjects
       where class_id = $1
       order by position asc, created_at asc`,
      [id],
    );

    return reply.send(result.rows);
  });

  app.get("/classes/:id/subjects/:subjectId/topics", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const pool = getPool();
    const { id, subjectId } = req.params as { id: string; subjectId: string };

    const subject = await pool.query(
      `select s.id
       from class_subjects s
       where s.class_id = $1 and s.id = $2
       limit 1`,
      [id, subjectId],
    );
    if (!subject.rows[0]) return reply.code(404).send({ message: "Not found" });

    const result = await pool.query(
      `select id, subject_id, name, is_completed, position, created_at, updated_at
       from class_subject_topics
       where subject_id = $1
       order by position asc, created_at asc`,
      [subjectId],
    );
    return reply.send(result.rows);
  });

  app.post("/classes/:id/subjects/:subjectId/topics", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const parsed = CreateTopicSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const pool = getPool();
    const { id, subjectId } = req.params as { id: string; subjectId: string };

    const subject = await pool.query(
      `select s.id
       from class_subjects s
       where s.class_id = $1 and s.id = $2
       limit 1`,
      [id, subjectId],
    );
    if (!subject.rows[0]) return reply.code(404).send({ message: "Not found" });

    const name = parsed.data.name.trim();
    const nextPosRes = await pool.query(
      `select coalesce(max(position), -1) as max_pos
       from class_subject_topics
       where subject_id = $1`,
      [subjectId],
    );
    const nextPosition = Number(nextPosRes.rows[0]?.max_pos ?? -1) + 1;
    const created = await pool.query(
      `insert into class_subject_topics (subject_id, name, position)
       values ($1, $2, $3)
       on conflict (subject_id, name)
       do update set updated_at = now()
       returning id, subject_id, name, is_completed, position, created_at, updated_at`,
      [subjectId, name, nextPosition],
    );

    return reply.code(201).send(created.rows[0]);
  });

  app.delete("/classes/:id/topics/:topicId", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const pool = getPool();
    const { id, topicId } = req.params as { id: string; topicId: string };

    const existing = await pool.query(
      `select t.id
       from class_subject_topics t
       join class_subjects s on s.id = t.subject_id
       where s.class_id = $1 and t.id = $2
       limit 1`,
      [id, topicId],
    );
    if (!existing.rows[0]) return reply.code(404).send({ message: "Not found" });

    await pool.query(`delete from class_subject_topics where id = $1`, [topicId]);
    return reply.code(204).send();
  });

  app.patch("/classes/:id/subjects/:subjectId/topics/reorder", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const parsed = ReorderIdsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const pool = getPool();
    const { id, subjectId } = req.params as { id: string; subjectId: string };

    const subject = await pool.query(
      `select s.id
       from class_subjects s
       where s.class_id = $1 and s.id = $2
       limit 1`,
      [id, subjectId],
    );
    if (!subject.rows[0]) return reply.code(404).send({ message: "Not found" });

    const ids = parsed.data.ids;
    const found = await pool.query(
      `select id from class_subject_topics where subject_id = $1 and id = any($2::uuid[])`,
      [subjectId, ids],
    );
    if (found.rowCount !== ids.length) {
      return reply.code(400).send({ message: "Some chapters do not belong to this subject" });
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      for (let i = 0; i < ids.length; i++) {
        await client.query(
          `update class_subject_topics
           set position = $2,
               updated_at = now()
           where id = $1`,
          [ids[i], i],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }

    const result = await pool.query(
      `select id, subject_id, name, is_completed, position, created_at, updated_at
       from class_subject_topics
       where subject_id = $1
       order by position asc, created_at asc`,
      [subjectId],
    );
    return reply.send(result.rows);
  });

  app.patch("/classes/:id/topics/:topicId", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const parsed = ToggleCompletedSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const pool = getPool();
    const { id, topicId } = req.params as { id: string; topicId: string };

    const existing = await pool.query(
      `select t.id
       from class_subject_topics t
       join class_subjects s on s.id = t.subject_id
       where s.class_id = $1 and t.id = $2
       limit 1`,
      [id, topicId],
    );
    if (!existing.rows[0]) return reply.code(404).send({ message: "Not found" });

    const updated = await pool.query(
      `update class_subject_topics
       set is_completed = $2,
           updated_at = now()
       where id = $1
       returning id, subject_id, name, is_completed, created_at, updated_at`,
      [topicId, parsed.data.is_completed],
    );

    return reply.send(updated.rows[0]);
  });

  app.get("/classes/:id/topics/:topicId/parts", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const pool = getPool();
    const { id, topicId } = req.params as { id: string; topicId: string };

    const topic = await pool.query(
      `select t.id
       from class_subject_topics t
       join class_subjects s on s.id = t.subject_id
       where s.class_id = $1 and t.id = $2
       limit 1`,
      [id, topicId],
    );
    if (!topic.rows[0]) return reply.code(404).send({ message: "Not found" });

    const result = await pool.query(
      `select id, topic_id, name, is_completed, position, created_at, updated_at
       from class_topic_parts
       where topic_id = $1
       order by position asc, created_at asc`,
      [topicId],
    );

    return reply.send(result.rows);
  });

  app.post("/classes/:id/topics/:topicId/parts", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const parsed = CreateTopicPartSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const pool = getPool();
    const { id, topicId } = req.params as { id: string; topicId: string };

    const topic = await pool.query(
      `select t.id
       from class_subject_topics t
       join class_subjects s on s.id = t.subject_id
       where s.class_id = $1 and t.id = $2
       limit 1`,
      [id, topicId],
    );
    if (!topic.rows[0]) return reply.code(404).send({ message: "Not found" });

    const name = parsed.data.name.trim();
    const nextPosRes = await pool.query(
      `select coalesce(max(position), -1) as max_pos
       from class_topic_parts
       where topic_id = $1`,
      [topicId],
    );
    const nextPosition = Number(nextPosRes.rows[0]?.max_pos ?? -1) + 1;
    const created = await pool.query(
      `insert into class_topic_parts (topic_id, name, position)
       values ($1, $2, $3)
       on conflict (topic_id, name)
       do update set updated_at = now()
       returning id, topic_id, name, is_completed, position, created_at, updated_at`,
      [topicId, name, nextPosition],
    );

    return reply.code(201).send(created.rows[0]);
  });

  app.delete("/classes/:id/parts/:partId", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const pool = getPool();
    const { id, partId } = req.params as { id: string; partId: string };

    const existing = await pool.query(
      `select p.id
       from class_topic_parts p
       join class_subject_topics t on t.id = p.topic_id
       join class_subjects s on s.id = t.subject_id
       where s.class_id = $1 and p.id = $2
       limit 1`,
      [id, partId],
    );
    if (!existing.rows[0]) return reply.code(404).send({ message: "Not found" });

    await pool.query(`delete from class_topic_parts where id = $1`, [partId]);
    return reply.code(204).send();
  });

  app.patch("/classes/:id/topics/:topicId/parts/reorder", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const parsed = ReorderIdsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const pool = getPool();
    const { id, topicId } = req.params as { id: string; topicId: string };

    const topic = await pool.query(
      `select t.id
       from class_subject_topics t
       join class_subjects s on s.id = t.subject_id
       where s.class_id = $1 and t.id = $2
       limit 1`,
      [id, topicId],
    );
    if (!topic.rows[0]) return reply.code(404).send({ message: "Not found" });

    const ids = parsed.data.ids;
    const found = await pool.query(
      `select id from class_topic_parts where topic_id = $1 and id = any($2::uuid[])`,
      [topicId, ids],
    );
    if (found.rowCount !== ids.length) {
      return reply.code(400).send({ message: "Some subparts do not belong to this chapter" });
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      for (let i = 0; i < ids.length; i++) {
        await client.query(
          `update class_topic_parts
           set position = $2,
               updated_at = now()
           where id = $1`,
          [ids[i], i],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }

    const result = await pool.query(
      `select id, topic_id, name, is_completed, position, created_at, updated_at
       from class_topic_parts
       where topic_id = $1
       order by position asc, created_at asc`,
      [topicId],
    );
    return reply.send(result.rows);
  });

  app.patch("/classes/:id/parts/:partId", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const parsed = ToggleCompletedSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const pool = getPool();
    const { id, partId } = req.params as { id: string; partId: string };

    const existing = await pool.query(
      `select p.id
       from class_topic_parts p
       join class_subject_topics t on t.id = p.topic_id
       join class_subjects s on s.id = t.subject_id
       where s.class_id = $1 and p.id = $2
       limit 1`,
      [id, partId],
    );
    if (!existing.rows[0]) return reply.code(404).send({ message: "Not found" });

    const updated = await pool.query(
      `update class_topic_parts
       set is_completed = $2,
           updated_at = now()
       where id = $1
       returning id, topic_id, name, is_completed, created_at, updated_at`,
      [partId, parsed.data.is_completed],
    );

    return reply.send(updated.rows[0]);
  });

  app.get("/classes/:id/subjects/:subjectId/materials", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const pool = getPool();
    const { id, subjectId } = req.params as { id: string; subjectId: string };

    const subject = await pool.query(
      `select s.id
       from class_subjects s
       where s.class_id = $1 and s.id = $2
       limit 1`,
      [id, subjectId],
    );
    if (!subject.rows[0]) return reply.code(404).send({ message: "Not found" });

    const result = await pool.query(
      `select id, subject_id, title, description, url, thumbnail_url, created_at, updated_at
       from class_subject_materials
       where subject_id = $1
       order by created_at desc`,
      [subjectId],
    );
    return reply.send(result.rows);
  });

  app.post("/classes/:id/subjects/:subjectId/materials", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const parsed = CreateMaterialSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const pool = getPool();
    const { id, subjectId } = req.params as { id: string; subjectId: string };

    const subject = await pool.query(
      `select s.id
       from class_subjects s
       where s.class_id = $1 and s.id = $2
       limit 1`,
      [id, subjectId],
    );
    if (!subject.rows[0]) return reply.code(404).send({ message: "Not found" });

    const data = parsed.data;
    const created = await pool.query(
      `insert into class_subject_materials (subject_id, title, description, url, thumbnail_url)
       values ($1, $2, $3, $4, $5)
       returning id, subject_id, title, description, url, thumbnail_url, created_at, updated_at`,
      [
        subjectId,
        data.title.trim(),
        (data.description ?? null) ? String(data.description).trim() : null,
        data.url.trim(),
        (data.thumbnail_url ?? null) ? String(data.thumbnail_url).trim() : null,
      ],
    );

    return reply.code(201).send(created.rows[0]);
  });

  app.post("/classes/:id/subjects/:subjectId/materials/:materialId/thumbnail", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const { id, subjectId, materialId } = req.params as { id: string; subjectId: string; materialId: string };

    const pool = getPool();
    const existing = await pool.query(
      `select m.id
       from class_subject_materials m
       join class_subjects s on s.id = m.subject_id
       where s.class_id = $1 and s.id = $2 and m.id = $3
       limit 1`,
      [id, subjectId, materialId],
    );
    if (!existing.rows[0]) return reply.code(404).send({ message: "Not found" });

    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ message: "thumbnail file is required" });

    const mime = String(file.mimetype || "");
    if (!mime.toLowerCase().startsWith("image/")) {
      return reply.code(400).send({ message: "Only image uploads are allowed" });
    }

    const ext = extFromMime(mime);
    if (!ext) {
      return reply.code(400).send({ message: "Unsupported image type (use jpg/png/webp)" });
    }

    const dir = path.join(uploadsRoot(), "materials", materialId);
    await fs.mkdir(dir, { recursive: true });
    const filename = `thumbnail.${ext}`;
    const filePath = path.join(dir, filename);

    const handle = await fs.open(filePath, "w");
    try {
      await pipeline(file.file, handle.createWriteStream());
    } finally {
      await handle.close();
    }

    const publicPath = `/uploads/materials/${materialId}/${filename}`;
    const saved = await pool.query(
      `update class_subject_materials
       set thumbnail_url = $2,
           updated_at = now()
       where id = $1
       returning id, thumbnail_url`,
      [materialId, publicPath],
    );

    return reply.code(201).send(saved.rows[0]);
  });

  app.post("/classes", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const parsed = CreateClassSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const pool = getPool();
    const { name, status, monthly_fee, short_description, class_timing, schedule } = parsed.data;

    const client = await pool.connect();
    try {
      await client.query("begin");

      const result = await client.query(
        `insert into classes (name, monthly_fee, short_description, class_timing, status, branch_id)
         values ($1, $2, $3, $4, $5, $6::uuid)
         returning id, name, monthly_fee, short_description, class_timing, thumbnail_url, banner_url, status, created_at, updated_at`,
        [name, monthly_fee ?? 0, short_description ?? null, class_timing ?? null, status, auth.user.branchId],
      );

      const created = result.rows[0] as { id: string };
      if (schedule && schedule.length > 0) {
        for (const e of schedule) {
          await client.query(
            `insert into class_weekly_schedule (class_id, day_of_week, is_off, start_time, end_time)
             values ($1, $2, $3, $4, $5)
             on conflict (class_id, day_of_week)
             do update set
               is_off = excluded.is_off,
               start_time = excluded.start_time,
               end_time = excluded.end_time,
               updated_at = now()`,
            [
              created.id,
              e.day_of_week,
              e.is_off ?? false,
              e.is_off ? null : (e.start_time ?? null),
              e.is_off ? null : (e.end_time ?? null),
            ],
          );
        }
      }

      await client.query("commit");

      const reloaded = await pool.query(
        `select
           c.id,
           c.name,
           c.monthly_fee,
           c.short_description,
           c.class_timing,
           c.thumbnail_url,
           c.banner_url,
           c.status,
           c.created_at,
           c.updated_at,
           coalesce(
             (
               select json_agg(
                 json_build_object(
                   'day_of_week', s.day_of_week,
                   'is_off', s.is_off,
                   'start_time', case when s.start_time is null then null else to_char(s.start_time, 'HH24:MI') end,
                   'end_time', case when s.end_time is null then null else to_char(s.end_time, 'HH24:MI') end
                 )
                 order by s.day_of_week
               )
               from class_weekly_schedule s
               where s.class_id = c.id
             ),
             '[]'::json
           ) as schedule
         from classes c
         where c.id = $1
           and ($2::uuid is null or c.branch_id = $2::uuid)
         limit 1`,
        [created.id, auth.user.branchId],
      );

      return reply.code(201).send(reloaded.rows[0]);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  });

  app.patch("/classes/:id", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const { id } = req.params as { id: string };
    const parsed = UpdateClassSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const pool = getPool();
    const existing = await pool.query(`select id from classes where id = $1 and ($2::uuid is null or branch_id = $2::uuid) limit 1`, [id, auth.user.branchId]);
    if (!existing.rows[0]) return reply.code(404).send({ message: "Not found" });

    const data = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("begin");

      await client.query(
        `update classes
         set name = case when $2::boolean then $3 else name end,
             monthly_fee = case when $4::boolean then $5 else monthly_fee end,
             short_description = case when $6::boolean then $7 else short_description end,
             class_timing = case when $8::boolean then $9 else class_timing end,
             status = case when $10::boolean then $11 else status end,
             updated_at = now()
         where id = $1`,
        [
          id,
          data.name !== undefined,
          data.name ?? null,
          data.monthly_fee !== undefined,
          data.monthly_fee ?? 0,
          data.short_description !== undefined,
          data.short_description ?? null,
          data.class_timing !== undefined,
          data.class_timing ?? null,
          data.status !== undefined,
          data.status ?? null,
        ],
      );

      if (data.schedule !== undefined) {
        await client.query(`delete from class_weekly_schedule where class_id = $1`, [id]);
        if (data.schedule.length > 0) {
          for (const e of data.schedule) {
            await client.query(
              `insert into class_weekly_schedule (class_id, day_of_week, is_off, start_time, end_time)
               values ($1, $2, $3, $4, $5)
               on conflict (class_id, day_of_week)
               do update set
                 is_off = excluded.is_off,
                 start_time = excluded.start_time,
                 end_time = excluded.end_time,
                 updated_at = now()`,
              [
                id,
                e.day_of_week,
                e.is_off ?? false,
                e.is_off ? null : (e.start_time ?? null),
                e.is_off ? null : (e.end_time ?? null),
              ],
            );
          }
        }
      }

      await client.query("commit");

      const reloaded = await pool.query(
        `select
           c.id,
           c.name,
           c.monthly_fee,
           c.short_description,
           c.class_timing,
           c.thumbnail_url,
           c.banner_url,
           c.status,
           c.created_at,
           c.updated_at,
           coalesce(
             (
               select json_agg(
                 json_build_object(
                   'day_of_week', s.day_of_week,
                   'is_off', s.is_off,
                   'start_time', case when s.start_time is null then null else to_char(s.start_time, 'HH24:MI') end,
                   'end_time', case when s.end_time is null then null else to_char(s.end_time, 'HH24:MI') end
                 )
                 order by s.day_of_week
               )
               from class_weekly_schedule s
               where s.class_id = c.id
             ),
             '[]'::json
           ) as schedule
         from classes c
         where c.id = $1
         limit 1`,
        [id],
      );

      return reply.send(reloaded.rows[0]);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  });

  app.post("/classes/:id/thumbnail", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const { id } = req.params as { id: string };

    const pool = getPool();
    const existing = await pool.query(`select id from classes where id = $1 and ($2::uuid is null or branch_id = $2::uuid) limit 1`, [id, auth.user.branchId]);
    if (!existing.rows[0]) return reply.code(404).send({ message: "Not found" });

    // Requires @fastify/multipart
    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ message: "thumbnail file is required" });

    const mime = String(file.mimetype || "");
    if (!mime.toLowerCase().startsWith("image/")) {
      return reply.code(400).send({ message: "Only image uploads are allowed" });
    }

    const ext = extFromMime(mime);
    if (!ext) {
      return reply.code(400).send({ message: "Unsupported image type (use jpg/png/webp)" });
    }

    const dir = path.join(uploadsRoot(), "classes", id);
    await fs.mkdir(dir, { recursive: true });
    const filename = `thumbnail.${ext}`;
    const filePath = path.join(dir, filename);

    const handle = await fs.open(filePath, "w");
    try {
      await pipeline(file.file, handle.createWriteStream());
    } finally {
      await handle.close();
    }

    const publicPath = `/uploads/classes/${id}/${filename}`;
    const saved = await pool.query(
      `update classes
       set thumbnail_url = $2,
           updated_at = now()
       where id = $1
       returning id, thumbnail_url`,
      [id, publicPath],
    );

    return reply.code(201).send(saved.rows[0]);
  });

  app.post("/classes/:id/banner", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const { id } = req.params as { id: string };

    const pool = getPool();
    const existing = await pool.query(`select id from classes where id = $1 and ($2::uuid is null or branch_id = $2::uuid) limit 1`, [id, auth.user.branchId]);
    if (!existing.rows[0]) return reply.code(404).send({ message: "Not found" });

    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ message: "banner file is required" });

    const mime = String(file.mimetype || "");
    if (!mime.toLowerCase().startsWith("image/")) {
      return reply.code(400).send({ message: "Only image uploads are allowed" });
    }

    const ext = extFromMime(mime);
    if (!ext) {
      return reply.code(400).send({ message: "Unsupported image type (use jpg/png/webp)" });
    }

    const dir = path.join(uploadsRoot(), "classes", id);
    await fs.mkdir(dir, { recursive: true });
    const filename = `banner.${ext}`;
    const filePath = path.join(dir, filename);

    const handle = await fs.open(filePath, "w");
    try {
      await pipeline(file.file, handle.createWriteStream());
    } finally {
      await handle.close();
    }

    const publicPath = `/uploads/classes/${id}/${filename}`;
    const saved = await pool.query(
      `update classes
       set banner_url = $2,
           updated_at = now()
       where id = $1
       returning id, banner_url`,
      [id, publicPath],
    );

    return reply.code(201).send(saved.rows[0]);
  });
}
