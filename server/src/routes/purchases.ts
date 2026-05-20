import type { FastifyInstance } from "fastify";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { requireAuth } from "../middleware/auth.js";
import { getPool } from "../db/pool.js";

const CreatePurchaseSchema = z.object({
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vendorName: z.string().trim().min(1).max(200),
  amount: z.number().finite().positive(),
  paymentMode: z.enum(["cash", "bank", "upi", "card", "other", "credit"]),
  liabilityLedgerCode: z
    .string()
    .trim()
    .min(1)
    .max(48)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
    .optional()
    .nullable(),
  reference: z.string().trim().max(200).optional().nullable(),
  narration: z.string().trim().max(500).optional().nullable(),
});

function uploadsRoot() {
  return path.resolve(process.cwd(), "Uploads");
}

function safeBasename(name: string): string {
  const base = path.basename(name || "").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return cleaned || "file";
}

function paymentModeToLedgerCode(paymentMode: "cash" | "bank" | "upi" | "card" | "other") {
  if (paymentMode === "cash") return "CASH";
  if (paymentMode === "upi") return "UPI";
  if (paymentMode === "card") return "CARD";
  return "BANK";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function registerPurchaseRoutes(app: FastifyInstance) {
  app.get("/purchases", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const QuerySchema = z.object({
      limit: z.coerce.number().int().min(1).max(200).optional().default(50),
      offset: z.coerce.number().int().min(0).optional().default(0),
    });

    const parsed = QuerySchema.safeParse((req.query ?? {}) as unknown);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid query", errors: parsed.error.issues });
    }

    const pool = getPool();
    const res = await pool.query(
      `select
         id,
         purchase_no,
         purchase_date,
         vendor_name,
         amount,
         payment_mode,
         liability_ledger_code,
         reference,
         narration,
         documents,
         created_at
       from purchases
       order by purchase_date desc, created_at desc
       limit $1 offset $2`,
      [parsed.data.limit, parsed.data.offset],
    );

    return reply.send(
      res.rows.map((r) => ({
        id: r.id as string,
        purchaseNo: r.purchase_no as string,
        purchaseDate: String(r.purchase_date).slice(0, 10),
        vendorName: r.vendor_name as string,
        amount: typeof r.amount === "number" ? r.amount : Number(r.amount),
        paymentMode: r.payment_mode as string,
        liabilityLedgerCode: (r.liability_ledger_code as string | null) ?? null,
        reference: (r.reference as string | null) ?? null,
        narration: (r.narration as string | null) ?? null,
        documents: (r.documents as any) ?? null,
        createdAt: (r.created_at as Date).toISOString(),
        type: "Asset Purchase",
      })),
    );
  });

  // Creates an asset purchase voucher:
  // Paid:   Dr FIXED_ASSETS, Cr Cash/Bank/UPI/Card
  // Credit: Dr FIXED_ASSETS, Cr CREDITORS_CTRL or LOAN_PAYABLE
  app.post("/purchases", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const parsed = CreatePurchaseSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const { purchaseDate, vendorName, amount, paymentMode, liabilityLedgerCode, reference, narration } = parsed.data;

    const normalizedLiabilityCode =
      paymentMode === "credit" ? String(liabilityLedgerCode || "").trim().toUpperCase() : null;

    if (paymentMode === "credit" && !normalizedLiabilityCode) {
      return reply.code(400).send({ message: "liabilityLedgerCode is required for credit purchases" });
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query("begin");

      if (paymentMode === "credit") {
        const chk = await client.query(
          `select nature
           from accounting_ledgers
           where code = $1
           limit 1`,
          [normalizedLiabilityCode],
        );
        const row = chk.rows[0] as { nature: string } | undefined;
        if (!row) {
          await client.query("rollback");
          return reply.code(400).send({ message: "Invalid liabilityLedgerCode" });
        }
        if (row.nature !== "liability") {
          await client.query("rollback");
          return reply.code(400).send({ message: "liabilityLedgerCode must be a liability ledger" });
        }
      }

      const insertRes = await client.query(
        `insert into purchases (
           purchase_no,
           purchase_date,
           vendor_name,
           amount,
           payment_mode,
           liability_ledger_code,
           reference,
           narration,
           documents,
           created_by
         )
         values (
           'PUR-' || to_char($1::date, 'YYYYMM') || '-' || lpad(nextval('purchase_no_seq')::text, 5, '0'),
           $1::date,
           $2,
           $3,
           $4,
           $5,
           $6,
           $7,
           '[]'::jsonb,
           $8::uuid
         )
         returning
           id,
           purchase_no,
           purchase_date::text as purchase_date,
           vendor_name,
           amount::text as amount,
           payment_mode,
           liability_ledger_code,
           reference,
           narration,
           documents,
           created_at`,
        [
          purchaseDate,
          vendorName,
          amount,
          paymentMode,
          paymentMode === "credit" ? normalizedLiabilityCode : null,
          reference ?? null,
          narration ?? null,
          isUuid(auth.user.id) ? auth.user.id : null,
        ],
      );

      const purchase = insertRes.rows[0] as {
        id: string;
        purchase_no: string;
        purchase_date: string;
        vendor_name: string;
        amount: string;
        payment_mode: string;
        liability_ledger_code: string | null;
        reference: string | null;
        narration: string | null;
        documents: unknown;
        created_at: Date;
      };

      const creditLedgerCode =
        paymentMode === "credit" ? (normalizedLiabilityCode as string) : paymentModeToLedgerCode(paymentMode);
      const combinedNarration = [
        narration?.trim() ? narration.trim() : "Asset purchase",
        reference?.trim() ? `Ref: ${reference.trim()}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      const voucherRes = await client.query(
        `insert into accounting_vouchers (
           voucher_type,
           voucher_no,
           voucher_date,
           party_student_id,
           party_name,
           narration,
           source_type,
           source_id
         )
         values ('Purchase', $1, $2::date, null, $3, $4, 'purchase', $5::uuid)
         on conflict (source_type, source_id)
         do update set
           voucher_no = excluded.voucher_no,
           voucher_date = excluded.voucher_date,
           party_name = excluded.party_name,
           narration = excluded.narration,
           updated_at = now()
         returning id`,
        [purchase.purchase_no, purchaseDate, vendorName, combinedNarration || null, purchase.id],
      );

      const voucherId = voucherRes.rows[0]?.id as string;
      await client.query(`delete from accounting_voucher_lines where voucher_id = $1::uuid`, [voucherId]);

      await client.query(
        `insert into accounting_voucher_lines (voucher_id, ledger_code, debit, credit)
         values ($1::uuid, 'FIXED_ASSETS', $2, 0)`,
        [voucherId, amount],
      );

      await client.query(
        `insert into accounting_voucher_lines (voucher_id, ledger_code, debit, credit)
         values ($1::uuid, $2, 0, $3)`,
        [voucherId, creditLedgerCode, amount],
      );

      await client.query("commit");

      return reply.code(201).send({
        id: purchase.id,
        purchaseNo: purchase.purchase_no,
        purchaseDate: purchase.purchase_date.slice(0, 10),
        vendorName: purchase.vendor_name,
        amount: Number(purchase.amount),
        paymentMode: purchase.payment_mode,
        liabilityLedgerCode: purchase.liability_ledger_code,
        reference: purchase.reference,
        narration: purchase.narration,
        documents: purchase.documents,
        createdAt: purchase.created_at.toISOString(),
      });
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  });

  app.post("/purchases/:id/documents", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const ParamsSchema = z.object({ id: z.string().uuid() });
    const paramsParsed = ParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ message: "Invalid params", errors: paramsParsed.error.issues });
    }

    const parts = (req as any).parts();
    if (!parts || typeof parts[Symbol.asyncIterator] !== "function") {
      return reply.code(400).send({ message: "Multipart request required" });
    }

    const pool = getPool();

    const purchaseRes = await pool.query(
      `select id, documents
       from purchases
       where id = $1::uuid
       limit 1`,
      [paramsParsed.data.id],
    );

    const row = purchaseRes.rows[0] as { id: string; documents: unknown } | undefined;
    if (!row) return reply.code(404).send({ message: "Purchase not found" });

    const dir = path.join(uploadsRoot(), "purchases", paramsParsed.data.id);
    await fs.mkdir(dir, { recursive: true });

    const newDocs: Array<{ name: string; url: string; uploaded_at: string }> = [];

    for await (const part of parts) {
      if (!part) continue;
      if (part.type !== "file") continue;
      if (part.fieldname !== "files") continue;

      const mime = String(part.mimetype || "");
      const isPdf = mime.toLowerCase() === "application/pdf";
      const isImage = mime.toLowerCase().startsWith("image/");
      if (!isPdf && !isImage) {
        continue;
      }

      const originalName = String(part.filename || "bill");
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

      const publicPath = `/uploads/purchases/${paramsParsed.data.id}/${filename}`;
      newDocs.push({ name: originalName, url: publicPath, uploaded_at: new Date().toISOString() });
    }

    if (newDocs.length === 0) {
      return reply.code(400).send({ message: "No supported files found (upload pdf or images as 'files')" });
    }

    const existing = Array.isArray(row.documents) ? (row.documents as any[]) : [];
    const merged = [...existing, ...newDocs];

    const updated = await pool.query(
      `update purchases
       set documents = $2::jsonb,
           updated_at = now()
       where id = $1::uuid
       returning documents`,
      [paramsParsed.data.id, JSON.stringify(merged)],
    );

    return reply.code(201).send({
      id: paramsParsed.data.id,
      documents: updated.rows[0]?.documents ?? merged,
    });
  });
}
