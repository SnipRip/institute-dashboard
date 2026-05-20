import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

const InvoiceItemSchema = z.object({
  desc: z.string().min(1),
  qty: z.number().int().positive(),
  price: z.number().finite().nonnegative(),
});

const CreateInvoiceSchema = z.object({
  invoiceNo: z.string().min(1),
  invoiceDate: z.string().min(8), // yyyy-mm-dd
  customerName: z.string().min(1),
  customerMobile: z.string().optional().nullable(),
  studentId: z.string().uuid().optional().nullable(),
  billingCategory: z.enum(["general", "library", "class"]).optional().default("general"),
  periodStart: z.string().min(8).optional().nullable(),
  periodEnd: z.string().min(8).optional().nullable(),
  gstRegistered: z.boolean().optional().default(true),
  items: z.array(InvoiceItemSchema).min(1),
});

const UpdateInvoiceSchema = CreateInvoiceSchema.extend({
  // Keep invoiceNo stable; allow sending it but ignore changes server-side.
  invoiceNo: z.string().min(1).optional(),
});

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toISODate(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  return "";
}

async function upsertInvoiceVoucherAndLines(opts: {
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  studentId: string | null;
  customerName: string;
  billingCategory: string;
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  branchId: string | null;
}) {
  const narration = `${opts.billingCategory.toUpperCase()} Invoice`;

  const voucherRes = await opts.client.query(
    `insert into accounting_vouchers (
        voucher_type,
        voucher_no,
        voucher_date,
        party_student_id,
        party_name,
        narration,
        source_type,
        source_id,
        branch_id
      )
     values ('Sales', $1, $2::date, $3::uuid, $4, $5, 'invoice', $6::uuid, $7::uuid)
     on conflict (source_type, source_id)
     do update set
       voucher_no = excluded.voucher_no,
       voucher_date = excluded.voucher_date,
       party_student_id = excluded.party_student_id,
       party_name = excluded.party_name,
       narration = excluded.narration,
       branch_id = excluded.branch_id,
       updated_at = now()
     returning id`,
    [
      opts.invoiceNo,
      opts.invoiceDate,
      opts.studentId,
      opts.customerName,
      narration,
      opts.invoiceId,
      opts.branchId,
    ],
  );

  const voucherId = voucherRes.rows[0]?.id as string;

  await opts.client.query(`delete from accounting_voucher_lines where voucher_id = $1::uuid`, [voucherId]);

  if (opts.totalAmount > 0) {
    await opts.client.query(
      `insert into accounting_voucher_lines (voucher_id, ledger_code, debit, credit)
       values ($1::uuid, 'DEBTORS_CTRL', $2, 0)`,
      [voucherId, opts.totalAmount],
    );
  }
  if (opts.subtotal > 0) {
    await opts.client.query(
      `insert into accounting_voucher_lines (voucher_id, ledger_code, debit, credit)
       values ($1::uuid, 'SALES', 0, $2)`,
      [voucherId, opts.subtotal],
    );
  }
  if (opts.gstAmount > 0) {
    await opts.client.query(
      `insert into accounting_voucher_lines (voucher_id, ledger_code, debit, credit)
       values ($1::uuid, 'OUTPUT_GST', 0, $2)`,
      [voucherId, opts.gstAmount],
    );
  }
}

async function findExistingStudentMonthInvoice(opts: {
  studentId: string;
  invoiceDate: string;
  excludeId?: string;
}) {
  const pool = getPool();
  const monthStartExpr =
    "make_date(extract(year from $2::date)::int, extract(month from $2::date)::int, 1)";
  const baseSql =
    `select id
     from billing_invoices
     where student_id = $1::uuid
       and billing_month = ${monthStartExpr}
       and status <> 'void'` +
    (opts.excludeId ? ` and id <> $3::uuid` : ``) +
    `
     limit 1`;

  const args = opts.excludeId
    ? [opts.studentId, opts.invoiceDate, opts.excludeId]
    : [opts.studentId, opts.invoiceDate];
  const res = await pool.query(baseSql, args);
  const row = res.rows[0] as { id: string } | undefined;
  return row?.id ?? null;
}

async function findExistingStudentLibraryPeriodInvoice(opts: {
  studentId: string;
  periodStart: string;
  periodEnd: string;
  branchId?: string | null;
  excludeId?: string;
}) {
  const pool = getPool();
  const baseSql =
    `select id
     from billing_invoices
     where student_id = $1::uuid
       and billing_category = 'library'
       and status <> 'void'
       and period_start = $2::date
       and period_end = $3::date
       and ($4::uuid is null or branch_id = $4::uuid)` +
    (opts.excludeId ? ` and id <> $5::uuid` : ``) +
    `
     limit 1`;

  const args = opts.excludeId
    ? [opts.studentId, opts.periodStart, opts.periodEnd, opts.branchId ?? null, opts.excludeId]
    : [opts.studentId, opts.periodStart, opts.periodEnd, opts.branchId ?? null];
  const res = await pool.query(baseSql, args);
  const row = res.rows[0] as { id: string } | undefined;
  return row?.id ?? null;
}

export async function registerBillingRoutes(app: FastifyInstance) {
  app.get("/billing/invoices", async (req, reply) => {
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
    const result = await pool.query(
      `select
        id,
        invoice_no,
        invoice_date,
        customer_name,
        total_amount,
        status,
        created_at
       from billing_invoices
       where ($3::uuid is null or branch_id = $3::uuid)
       order by invoice_date desc, created_at desc
       limit $1 offset $2`,
      [parsed.data.limit, parsed.data.offset, auth.user.branchId],
    );

    return reply.send(
      result.rows.map((r) => ({
        id: r.id as string,
        invoiceNo: r.invoice_no as string,
        invoiceDate: toISODate(r.invoice_date),
        customerName: r.customer_name as string,
        totalAmount: typeof r.total_amount === "number" ? r.total_amount : Number(r.total_amount),
        status: r.status as string,
        createdAt: (r.created_at as Date).toISOString(),
        type: "Sales Invoice",
      })),
    );
  });

  app.get("/billing/invoices/:id", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const ParamsSchema = z.object({ id: z.string().uuid() });
    const paramsParsed = ParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ message: "Invalid params", errors: paramsParsed.error.issues });
    }

    const pool = getPool();
    const invoiceRes = await pool.query(
      `select
        id,
        invoice_no,
        invoice_date,
        student_id,
        customer_name,
        customer_mobile,
        billing_category,
        period_start,
        period_end,
        gst_registered,
        subtotal_amount,
        gst_amount,
        total_amount,
        status,
        created_at,
        updated_at
       from billing_invoices
       where id = $1
         and ($2::uuid is null or branch_id = $2::uuid)
       limit 1`,
      [paramsParsed.data.id, auth.user.branchId],
    );

    const invoice = invoiceRes.rows[0] as
      | {
          id: string;
          invoice_no: string;
          invoice_date: unknown;
          student_id: string | null;
          customer_name: string;
          customer_mobile: string | null;
          billing_category: string;
          period_start: unknown | null;
          period_end: unknown | null;
          gst_registered: boolean;
          subtotal_amount: unknown;
          gst_amount: unknown;
          total_amount: unknown;
          status: string;
          created_at: Date;
          updated_at: Date;
        }
      | undefined;

    if (!invoice) return reply.code(404).send({ message: "Invoice not found" });

    const itemsRes = await pool.query(
      `select id, description, quantity, unit_price
       from billing_invoice_items
       where invoice_id = $1
       order by created_at asc`,
      [invoice.id],
    );

    return reply.send({
      id: invoice.id,
      invoiceNo: invoice.invoice_no,
      invoiceDate: toISODate(invoice.invoice_date),
      studentId: invoice.student_id,
      customerName: invoice.customer_name,
      customerMobile: invoice.customer_mobile,
      billingCategory: invoice.billing_category,
      periodStart: invoice.period_start ? toISODate(invoice.period_start) : null,
      periodEnd: invoice.period_end ? toISODate(invoice.period_end) : null,
      gstRegistered: invoice.gst_registered,
      subtotalAmount: typeof invoice.subtotal_amount === "number" ? invoice.subtotal_amount : Number(invoice.subtotal_amount),
      gstAmount: typeof invoice.gst_amount === "number" ? invoice.gst_amount : Number(invoice.gst_amount),
      totalAmount: typeof invoice.total_amount === "number" ? invoice.total_amount : Number(invoice.total_amount),
      status: invoice.status,
      createdAt: invoice.created_at.toISOString(),
      updatedAt: invoice.updated_at.toISOString(),
      items: (itemsRes.rows as Array<{ id: string; description: string; quantity: number; unit_price: unknown }>).map((r) => ({
        id: r.id,
        desc: r.description,
        qty: r.quantity,
        price: typeof r.unit_price === "number" ? r.unit_price : Number(r.unit_price),
      })),
    });
  });

  app.post("/billing/invoices", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const parsed = CreateInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const pool = getPool();
    const {
      invoiceNo,
      invoiceDate,
      customerName,
      customerMobile,
      studentId,
      billingCategory,
      periodStart,
      periodEnd,
      gstRegistered,
      items,
    } = parsed.data;

    if (studentId && billingCategory === "library" && periodStart && periodEnd) {
      const existingId = await findExistingStudentLibraryPeriodInvoice({ studentId, periodStart, periodEnd, branchId: auth.user.branchId });
      if (existingId) {
        return reply
          .code(409)
          .send({ message: "Invoice already exists for this student for this library billing period.", existingInvoiceId: existingId });
      }
    }

    const subtotal = round2(items.reduce((sum, it) => sum + it.qty * it.price, 0));
    const gstRate = gstRegistered ? 0.18 : 0;
    const gstAmount = round2(subtotal * gstRate);
    const totalAmount = round2(subtotal + gstAmount);

    const client = await pool.connect();
    try {
      await client.query("begin");

      const invoiceRes = await client.query(
        `insert into billing_invoices (
            invoice_no,
            invoice_date,
            student_id,
            customer_name,
            customer_mobile,
            billing_category,
            period_start,
            period_end,
            gst_registered,
            subtotal_amount,
            gst_amount,
            total_amount,
            status,
            branch_id
          )
         values ($1, $2::date, $3::uuid, $4, $5, $6, $7::date, $8::date, $9, $10, $11, $12, 'issued', $13::uuid)
         returning id, invoice_no, invoice_date, customer_name, total_amount, status, created_at`,
        [
          invoiceNo,
          invoiceDate,
          studentId ?? null,
          customerName,
          customerMobile ?? null,
          billingCategory,
          periodStart ?? null,
          periodEnd ?? null,
          gstRegistered,
          subtotal,
          gstAmount,
          totalAmount,
          auth.user.branchId,
        ],
      );

      const invoiceRow = invoiceRes.rows[0] as {
        id: string;
        invoice_no: string;
        invoice_date: Date;
        customer_name: string;
        total_amount: unknown;
        status: string;
        created_at: Date;
      };

      for (const it of items) {
        await client.query(
          `insert into billing_invoice_items (invoice_id, description, quantity, unit_price)
           values ($1::uuid, $2, $3, $4)`,
          [invoiceRow.id, it.desc, it.qty, round2(it.price)],
        );
      }

      await upsertInvoiceVoucherAndLines({
        client,
        invoiceId: invoiceRow.id,
        invoiceNo: invoiceRow.invoice_no,
        invoiceDate,
        studentId: studentId ?? null,
        customerName,
        billingCategory,
        subtotal,
        gstAmount,
        totalAmount,
        branchId: auth.user.branchId,
      });

      await client.query("commit");

      return reply.code(201).send({
        id: invoiceRow.id,
        invoiceNo: invoiceRow.invoice_no,
        invoiceDate: toISODate(invoiceRow.invoice_date),
        customerName: invoiceRow.customer_name,
        totalAmount:
          typeof invoiceRow.total_amount === "number"
            ? invoiceRow.total_amount
            : Number(invoiceRow.total_amount),
        status: invoiceRow.status,
        createdAt: invoiceRow.created_at.toISOString(),
      });
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  });

  app.put("/billing/invoices/:id", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const ParamsSchema = z.object({ id: z.string().uuid() });
    const paramsParsed = ParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ message: "Invalid params", errors: paramsParsed.error.issues });
    }

    const parsed = UpdateInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const pool = getPool();
    const {
      invoiceDate,
      customerName,
      customerMobile,
      studentId,
      billingCategory,
      periodStart,
      periodEnd,
      gstRegistered,
      items,
    } = parsed.data;

    if (studentId && billingCategory === "library" && periodStart && periodEnd) {
      const existingId = await findExistingStudentLibraryPeriodInvoice({
        studentId,
        periodStart,
        periodEnd,
        branchId: auth.user.branchId,
        excludeId: paramsParsed.data.id,
      });
      if (existingId) {
        return reply
          .code(409)
          .send({ message: "Another invoice already exists for this student for this library billing period.", existingInvoiceId: existingId });
      }
    }

    const subtotal = round2(items.reduce((sum, it) => sum + it.qty * it.price, 0));
    const gstRate = gstRegistered ? 0.18 : 0;
    const gstAmount = round2(subtotal * gstRate);
    const totalAmount = round2(subtotal + gstAmount);

    const client = await pool.connect();
    try {
      await client.query("begin");

      const existingRes = await client.query(
        `select id, invoice_no
         from billing_invoices
         where id = $1
           and ($2::uuid is null or branch_id = $2::uuid)
         limit 1`,
        [paramsParsed.data.id, auth.user.branchId],
      );
      const existing = existingRes.rows[0] as { id: string; invoice_no: string } | undefined;
      if (!existing) {
        await client.query("rollback");
        return reply.code(404).send({ message: "Invoice not found" });
      }

      await client.query(
        `update billing_invoices
         set invoice_date = $2::date,
             student_id = $3::uuid,
             customer_name = $4,
             customer_mobile = $5,
             billing_category = $6,
             period_start = $7::date,
             period_end = $8::date,
             gst_registered = $9,
             subtotal_amount = $10,
             gst_amount = $11,
             total_amount = $12,
             updated_at = now()
         where id = $1`,
        [
          existing.id,
          invoiceDate,
          studentId ?? null,
          customerName,
          customerMobile ?? null,
          billingCategory,
          periodStart ?? null,
          periodEnd ?? null,
          gstRegistered,
          subtotal,
          gstAmount,
          totalAmount,
        ],
      );

      await client.query(`delete from billing_invoice_items where invoice_id = $1`, [existing.id]);

      for (const it of items) {
        await client.query(
          `insert into billing_invoice_items (invoice_id, description, quantity, unit_price)
           values ($1::uuid, $2, $3, $4)`,
          [existing.id, it.desc, it.qty, round2(it.price)],
        );
      }

      await upsertInvoiceVoucherAndLines({
        client,
        invoiceId: existing.id,
        invoiceNo: existing.invoice_no,
        invoiceDate,
        studentId: studentId ?? null,
        customerName,
        billingCategory,
        subtotal,
        gstAmount,
        totalAmount,
        branchId: auth.user.branchId,
      });

      await client.query("commit");

      return reply.send({
        id: existing.id,
        invoiceNo: existing.invoice_no,
        invoiceDate,
        customerName,
        customerMobile: customerMobile ?? null,
        studentId: studentId ?? null,
        gstRegistered,
        subtotalAmount: subtotal,
        gstAmount,
        totalAmount,
        status: "issued",
      });
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  });
}
