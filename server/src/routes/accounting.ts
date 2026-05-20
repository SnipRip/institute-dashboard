import type { FastifyInstance } from "fastify";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { requireAuth } from "../middleware/auth.js";
import { getPool } from "../db/pool.js";

const ExpenseLedgerCode = z.enum([
  "EXPENSE_MISC",
  "EXP_ELECTRICITY",
  "EXP_WIFI",
  "EXP_MAINTENANCE",
  "EXP_SALARIES",
]);

const CreateExpenseSchema = z.object({
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().finite().positive(),
  paymentMode: z.enum(["cash", "bank", "upi", "card", "other"]),
  ledgerCode: ExpenseLedgerCode.optional().default("EXPENSE_MISC"),
  payeeName: z.string().trim().max(200).optional().nullable(),
  narration: z.string().trim().max(500).optional().nullable(),
  reference: z.string().trim().max(200).optional().nullable(),
});

function paymentModeToLedgerCode(paymentMode: "cash" | "bank" | "upi" | "card" | "other") {
  if (paymentMode === "cash") return "CASH";
  if (paymentMode === "upi") return "UPI";
  if (paymentMode === "card") return "CARD";
  return "BANK";
}

function uploadsRoot() {
  return path.resolve(process.cwd(), "Uploads");
}

function safeBasename(name: string): string {
  const base = path.basename(name || "").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return cleaned || "file";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeLedgerCodeFromName(name: string): string {
  const raw = String(name || "").trim();
  const base = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const safe = base || "LEDGER";
  const startsOk = /^[A-Z]/.test(safe);
  const prefixed = startsOk ? safe : `LEDGER_${safe}`;

  // Keep codes reasonably short for readability.
  return prefixed.slice(0, 48);
}

export async function registerAccountingRoutes(app: FastifyInstance) {
  app.get("/accounting/ledgers", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const QuerySchema = z.object({
      nature: z.enum(["asset", "liability", "income", "expense"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional().default(200),
      offset: z.coerce.number().int().min(0).optional().default(0),
    });

    const parsed = QuerySchema.safeParse((req.query ?? {}) as unknown);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid query", errors: parsed.error.issues });
    }

    const pool = getPool();
    const res = parsed.data.nature
      ? await pool.query(
          `select code, name, nature, created_at, updated_at
           from accounting_ledgers
           where nature = $1
           order by name asc
           limit $2 offset $3`,
          [parsed.data.nature, parsed.data.limit, parsed.data.offset],
        )
      : await pool.query(
          `select code, name, nature, created_at, updated_at
           from accounting_ledgers
           order by name asc
           limit $1 offset $2`,
          [parsed.data.limit, parsed.data.offset],
        );

    return reply.send(
      res.rows.map((r) => ({
        code: r.code as string,
        name: r.name as string,
        nature: r.nature as string,
        createdAt: (r.created_at as Date).toISOString(),
        updatedAt: (r.updated_at as Date).toISOString(),
      })),
    );
  });

  app.post("/accounting/ledgers", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const CreateLedgerSchema = z.object({
      name: z.string().trim().min(1).max(200),
      nature: z.enum(["asset", "liability", "income", "expense"]),
      code: z
        .string()
        .trim()
        .min(1)
        .max(48)
        .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
        .optional()
        .nullable(),
    });

    const parsed = CreateLedgerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      const requestedCode = (parsed.data.code || "").trim();
      const baseCode = requestedCode ? requestedCode.toUpperCase() : normalizeLedgerCodeFromName(parsed.data.name);

      // Ensure uniqueness by suffixing if needed.
      let code = baseCode;
      for (let attempt = 0; attempt < 50; attempt++) {
        const suffix = attempt === 0 ? "" : `_${attempt + 1}`;
        code = (baseCode.slice(0, 48 - suffix.length) + suffix).toUpperCase();

        const ins = await client.query(
          `insert into accounting_ledgers (code, name, nature)
           values ($1, $2, $3)
           on conflict (code) do nothing
           returning code, name, nature, created_at, updated_at`,
          [code, parsed.data.name, parsed.data.nature],
        );
        if (ins.rowCount === 1) {
          const r = ins.rows[0] as any;
          return reply.code(201).send({
            code: r.code as string,
            name: r.name as string,
            nature: r.nature as string,
            createdAt: (r.created_at as Date).toISOString(),
            updatedAt: (r.updated_at as Date).toISOString(),
          });
        }
      }

      return reply.code(409).send({ message: "Unable to generate a unique ledger code" });
    } finally {
      client.release();
    }
  });

  app.get("/accounting/expenses", async (req, reply) => {
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
         e.id,
         e.expense_no,
         e.expense_date,
         e.payee_name,
         e.amount,
         e.payment_mode,
         e.ledger_code,
         e.reference,
         e.narration,
         e.documents,
         e.created_at,
         v.id as voucher_id,
         v.voucher_no,
         v.voucher_date
       from expenses e
       left join accounting_vouchers v
         on v.source_type = 'expense' and v.source_id = e.id
       order by e.expense_date desc, e.created_at desc
       limit $1 offset $2`,
      [parsed.data.limit, parsed.data.offset],
    );

    return reply.send(
      res.rows.map((r) => ({
        id: r.id as string,
        expenseNo: r.expense_no as string,
        expenseDate: String(r.expense_date).slice(0, 10),
        payeeName: (r.payee_name as string | null) ?? null,
        amount: typeof r.amount === "number" ? r.amount : Number(r.amount),
        paymentMode: r.payment_mode as string,
        ledgerCode: r.ledger_code as string,
        reference: (r.reference as string | null) ?? null,
        narration: (r.narration as string | null) ?? null,
        documents: (r.documents as any) ?? null,
        createdAt: (r.created_at as Date).toISOString(),
        voucherId: (r.voucher_id as string | null) ?? null,
        voucherNo: (r.voucher_no as string | null) ?? null,
        voucherDate: r.voucher_date ? String(r.voucher_date).slice(0, 10) : null,
        type: "Expense",
      })),
    );
  });

  // Expense + Payment voucher:
  // Dr <expense ledger>, Cr Cash/Bank/UPI/Card
  app.post("/accounting/expenses", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const parsed = CreateExpenseSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const { expenseDate, amount, paymentMode, ledgerCode, narration, reference, payeeName } = parsed.data;

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query("begin");

      const expenseNoRes = await client.query(
        `select 'EXP-' || to_char($1::date, 'YYYYMM') || '-' || lpad(nextval('expense_no_seq')::text, 5, '0') as expense_no`,
        [expenseDate],
      );
      const expenseNo = expenseNoRes.rows[0]?.expense_no as string;

      const createdBy = isUuid(auth.user.id) ? auth.user.id : null;

      const expenseRes = await client.query(
        `insert into expenses (
           expense_no,
           expense_date,
           payee_name,
           amount,
           payment_mode,
           ledger_code,
           reference,
           narration,
           documents,
           created_by
         )
         values ($1, $2::date, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::uuid)
         returning id, expense_no`,
        [
          expenseNo,
          expenseDate,
          payeeName?.trim() ? payeeName.trim() : null,
          amount,
          paymentMode,
          ledgerCode,
          reference?.trim() ? reference.trim() : null,
          narration?.trim() ? narration.trim() : null,
          JSON.stringify([]),
          createdBy,
        ],
      );

      const expense = expenseRes.rows[0] as { id: string; expense_no: string };

      const voucherNoRes = await client.query(
        `select 'PAY-' || to_char($1::date, 'YYYYMM') || '-' || lpad(nextval('accounting_voucher_no_seq')::text, 5, '0') as voucher_no`,
        [expenseDate],
      );
      const voucherNo = voucherNoRes.rows[0]?.voucher_no as string;

      const paymentLedgerCode = paymentModeToLedgerCode(paymentMode);
      const combinedNarration = [
        narration?.trim() ? narration.trim() : "Expense",
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
         values ('Payment', $1, $2::date, null, $3, $4, 'expense', $5::uuid)
         returning id, voucher_no, voucher_date::text as voucher_date, voucher_type`,
        [voucherNo, expenseDate, payeeName?.trim() ? payeeName.trim() : null, combinedNarration || null, expense.id],
      );

      const voucher = voucherRes.rows[0] as { id: string; voucher_no: string; voucher_date: string; voucher_type: string };

      await client.query(
        `insert into accounting_voucher_lines (voucher_id, ledger_code, debit, credit)
         values ($1::uuid, $2, $3, 0)`,
        [voucher.id, ledgerCode, amount],
      );
      await client.query(
        `insert into accounting_voucher_lines (voucher_id, ledger_code, debit, credit)
         values ($1::uuid, $2, 0, $3)`,
        [voucher.id, paymentLedgerCode, amount],
      );

      await client.query("commit");

      return reply.code(201).send({
        id: expense.id,
        expenseNo: expense.expense_no,
        voucherId: voucher.id,
        voucherNo: voucher.voucher_no,
        voucherDate: voucher.voucher_date,
        voucherType: voucher.voucher_type,
        amount,
        paymentLedgerCode,
      });
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  });

  app.post("/accounting/expenses/:id/documents", async (req, reply) => {
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
    const expenseRes = await pool.query(
      `select id, documents
       from expenses
       where id = $1::uuid
       limit 1`,
      [paramsParsed.data.id],
    );

    const row = expenseRes.rows[0] as { id: string; documents: unknown } | undefined;
    if (!row) return reply.code(404).send({ message: "Expense not found" });

    const dir = path.join(uploadsRoot(), "expenses", paramsParsed.data.id);
    await fs.mkdir(dir, { recursive: true });

    const newDocs: Array<{ name: string; url: string; uploaded_at: string }> = [];

    for await (const part of parts) {
      if (!part) continue;
      if (part.type !== "file") continue;
      if (part.fieldname !== "files") continue;

      const mime = String(part.mimetype || "");
      const isPdf = mime.toLowerCase() === "application/pdf";
      const isImage = mime.toLowerCase().startsWith("image/");
      if (!isPdf && !isImage) continue;

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

      const publicPath = `/uploads/expenses/${paramsParsed.data.id}/${filename}`;
      newDocs.push({ name: originalName, url: publicPath, uploaded_at: new Date().toISOString() });
    }

    if (newDocs.length === 0) {
      return reply.code(400).send({ message: "No supported files found (upload pdf or images as 'files')" });
    }

    const existing = Array.isArray(row.documents) ? (row.documents as any[]) : [];
    const merged = [...existing, ...newDocs];

    const updated = await pool.query(
      `update expenses
       set documents = $2::jsonb,
           updated_at = now()
       where id = $1::uuid
       returning documents`,
      [paramsParsed.data.id, JSON.stringify(merged)],
    );

    return reply.code(201).send({ id: paramsParsed.data.id, documents: updated.rows[0]?.documents ?? merged });
  });
}
