import type { FastifyInstance } from "fastify";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { getPool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

const DocumentSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  uploaded_at: z.string().optional(),
});

const BusinessModulesSchema = z.object({
  selfStudyLibrary: z.boolean().optional(),
  coaching: z.boolean().optional(),
  school: z.boolean().optional(),
  books: z.boolean().optional(),
  lockers: z.boolean().optional(),
  billing: z.boolean().optional(),
  accounting: z.boolean().optional(),
  purchases: z.boolean().optional(),
  reports: z.boolean().optional(),
  staff: z.boolean().optional(),
  users: z.boolean().optional(),
});

const DEFAULT_BUSINESS_MODULES = {
  selfStudyLibrary: true,
  coaching: true,
  school: false,
  books: true,
  lockers: true,
  billing: true,
  accounting: true,
  purchases: true,
  reports: true,
  staff: true,
  users: true,
};

const UpdateCompanySchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  pincode: z.string().optional().nullable(),
  gst: z.string().optional().nullable(),
  pan: z.string().optional().nullable(),
  logo_url: z.string().optional().nullable(),
  documents: z.array(DocumentSchema).optional().nullable(),
  business_modules: BusinessModulesSchema.optional().nullable(),
});

function normalizeBusinessModules(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_BUSINESS_MODULES;
  return { ...DEFAULT_BUSINESS_MODULES, ...(raw as Record<string, unknown>) };
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

function safeBasename(name: string): string {
  const base = path.basename(name || "").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return cleaned || "file";
}

async function ensureCompanyRow() {
  const pool = getPool();
  await pool.query(
    `insert into company_settings (id)
     values (1)
     on conflict (id) do nothing`,
  );
}

export async function registerCompanyRoutes(app: FastifyInstance) {
  // Public branding endpoint for pre-auth pages (e.g. login).
  // Intentionally limited to non-sensitive fields.
  app.get("/company/public", async (_req, reply) => {
    await ensureCompanyRow();

    const pool = getPool();
    const res = await pool.query(
      `select
         name,
         logo_url
       from company_settings
       where id = 1
       limit 1`,
    );

    const row = res.rows[0] as any;
    return reply.send({
      name: row?.name ?? "",
      logo_url: row?.logo_url ?? null,
    });
  });

  app.get("/company", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    await ensureCompanyRow();

    const pool = getPool();
    const res = await pool.query(
      `select
         id,
         name,
         profile_completed,
         address,
         phone,
         email,
         state,
         city,
         pincode,
         gst,
         pan,
         logo_url,
         business_modules,
         documents,
         updated_at
       from company_settings
       where id = 1
       limit 1`,
    );

    const row = res.rows[0] as any;
    if (!row) {
      return reply.send({
        id: "1",
        name: "",
        profile_completed: false,
        address: "",
        phone: "",
        email: "",
        state: "",
        city: "",
        pincode: "",
        gst: "",
        pan: "",
        logo_url: null,
        business_modules: DEFAULT_BUSINESS_MODULES,
        documents: null,
      });
    }

    return reply.send({
      id: String(row.id),
      name: row.name ?? "",
      profile_completed: Boolean(row.profile_completed),
      address: row.address ?? "",
      phone: row.phone ?? "",
      email: row.email ?? "",
      state: row.state ?? "",
      city: row.city ?? "",
      pincode: row.pincode ?? "",
      gst: row.gst ?? "",
      pan: row.pan ?? "",
      logo_url: row.logo_url ?? null,
      business_modules: normalizeBusinessModules(row.business_modules),
      documents: row.documents ?? null,
    });
  });

  app.put("/company", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const parsed = UpdateCompanySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    await ensureCompanyRow();

    const d = parsed.data;
    const pool = getPool();

    const res = await pool.query(
      `update company_settings
       set
         name = $1,
         profile_completed = true,
         address = $2,
         phone = $3,
         email = $4,
         state = $5,
         city = $6,
         pincode = $7,
         gst = $8,
         pan = $9,
         logo_url = $10,
         documents = $11::jsonb,
         business_modules = $12::jsonb,
         updated_at = now()
       where id = 1
       returning
         id,
         name,
         profile_completed,
         address,
         phone,
         email,
         state,
         city,
         pincode,
         gst,
         pan,
         logo_url,
         business_modules,
         documents`,
      [
        d.name,
        d.address ?? null,
        d.phone ?? null,
        d.email ?? null,
        d.state ?? null,
        d.city ?? null,
        d.pincode ?? null,
        d.gst ?? null,
        d.pan ?? null,
        d.logo_url ?? null,
        d.documents ? JSON.stringify(d.documents) : null,
        JSON.stringify(normalizeBusinessModules(d.business_modules)),
      ],
    );

    const row = res.rows[0] as any;
    return reply.send({
      id: String(row.id),
      name: row.name ?? "",
      profile_completed: Boolean(row.profile_completed),
      address: row.address ?? "",
      phone: row.phone ?? "",
      email: row.email ?? "",
      state: row.state ?? "",
      city: row.city ?? "",
      pincode: row.pincode ?? "",
      gst: row.gst ?? "",
      pan: row.pan ?? "",
      logo_url: row.logo_url ?? null,
      business_modules: normalizeBusinessModules(row.business_modules),
      documents: row.documents ?? null,
    });
  });

  app.post("/company/logo", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ message: "file is required" });

    const mime = String(file.mimetype || "");
    if (!mime.toLowerCase().startsWith("image/")) {
      return reply.code(400).send({ message: "Only image uploads are allowed" });
    }

    const ext = extFromMime(mime);
    if (!ext) {
      return reply.code(400).send({ message: "Unsupported image type (use jpg/png/webp)" });
    }

    const dir = path.join(uploadsRoot(), "company");
    await fs.mkdir(dir, { recursive: true });

    const filename = `logo.${ext}`;
    const filePath = path.join(dir, filename);

    const handle = await fs.open(filePath, "w");
    try {
      await pipeline(file.file, handle.createWriteStream());
    } finally {
      await handle.close();
    }

    const publicPath = `/uploads/company/${filename}`;

    await ensureCompanyRow();
    const pool = getPool();
    const saved = await pool.query(
      `update company_settings
       set logo_url = $1,
           updated_at = now()
       where id = 1
       returning logo_url`,
      [publicPath],
    );

    return reply.code(201).send({ logo_url: saved.rows[0]?.logo_url ?? publicPath });
  });

  app.post("/company/documents", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const parts = (req as any).parts();
    if (!parts || typeof parts[Symbol.asyncIterator] !== "function") {
      return reply.code(400).send({ message: "Multipart request required" });
    }

    const dir = path.join(uploadsRoot(), "company", "documents");
    await fs.mkdir(dir, { recursive: true });

    const newDocs: Array<{ name: string; url: string; uploaded_at: string }> = [];

    for await (const part of parts) {
      if (!part) continue;
      if (part.type !== "file") continue;
      if (part.fieldname !== "files") continue;

      const originalName = String(part.filename || "document");
      const base = safeBasename(originalName);
      const unique = crypto.randomUUID();
      const filename = `${unique}-${base}`;
      const filePath = path.join(dir, filename);

      const handle = await fs.open(filePath, "w");
      try {
        await pipeline(part.file, handle.createWriteStream());
      } finally {
        await handle.close();
      }

      const publicPath = `/uploads/company/documents/${filename}`;
      newDocs.push({
        name: originalName,
        url: publicPath,
        uploaded_at: new Date().toISOString(),
      });
    }

    if (newDocs.length === 0) {
      return reply.code(400).send({ message: "At least one file (field name 'files') is required" });
    }

    await ensureCompanyRow();

    const pool = getPool();
    const existingRes = await pool.query(
      `select documents
       from company_settings
       where id = 1
       limit 1`,
    );

    const existing = existingRes.rows[0]?.documents;
    const existingList = Array.isArray(existing) ? existing : [];
    const merged = [...existingList, ...newDocs];

    const saved = await pool.query(
      `update company_settings
       set documents = $1::jsonb,
           updated_at = now()
       where id = 1
       returning documents`,
      [JSON.stringify(merged)],
    );

    return reply.code(201).send({ documents: saved.rows[0]?.documents ?? merged });
  });
}
