import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { getPool } from "../db/pool.js";

const CreateReceiptSchema = z.object({
  studentId: z.string().uuid(),
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().finite().positive(),
  paymentMode: z.enum(["cash", "bank", "upi", "card", "other"]),
  reference: z.string().trim().max(200).optional().nullable(),
  narration: z.string().trim().max(500).optional().nullable(),
});

export async function registerReceiptRoutes(app: FastifyInstance) {
  app.get("/receipts", async (req, reply) => {
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
        r.id,
        r.receipt_no,
        r.receipt_date,
        r.student_id,
        st.full_name as student_name,
        r.amount,
        r.payment_mode,
        r.reference,
        r.narration,
        r.created_at
      from receipts r
      join students st on st.id = r.student_id
      where ($3::uuid is null or r.branch_id = $3::uuid)
      order by r.receipt_date desc, r.created_at desc
      limit $1 offset $2`,
      [parsed.data.limit, parsed.data.offset, auth.user.branchId],
    );

    return reply.send(
      res.rows.map((r) => ({
        id: r.id as string,
        receiptNo: r.receipt_no as string,
        receiptDate: String(r.receipt_date).slice(0, 10),
        studentId: r.student_id as string,
        studentName: r.student_name as string,
        amount: typeof r.amount === "number" ? r.amount : Number(r.amount),
        paymentMode: r.payment_mode as string,
        reference: (r.reference as string | null) ?? null,
        narration: (r.narration as string | null) ?? null,
        createdAt: (r.created_at as Date).toISOString(),
        type: "Receipt",
        status: "Received",
      })),
    );
  });

  app.post("/receipts", async (req, reply) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return reply.code(auth.status).send({ message: "Unauthorized" });

    const parsed = CreateReceiptSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid body", errors: parsed.error.issues });
    }

    const { studentId, receiptDate, amount, paymentMode, reference, narration } = parsed.data;

    const pool = getPool();

    const client = await pool.connect();
    try {
      await client.query("begin");

      const studentRes = await client.query(
        `select id, full_name
         from students
         where id = $1
           and ($2::uuid is null or branch_id = $2::uuid)
         limit 1`,
        [studentId, auth.user.branchId],
      );
      const student = studentRes.rows[0] as { id: string; full_name: string } | undefined;
      if (!student) {
        await client.query("rollback");
        return reply.code(404).send({ message: "Student not found" });
      }

      // Receipt no pattern: RCPT-YYYYMM-00001 (sequence is global)
      const insertRes = await client.query(
        `insert into receipts (receipt_no, receipt_date, student_id, amount, payment_mode, reference, narration, branch_id)
         values (
           'RCPT-' || to_char($1::date, 'YYYYMM') || '-' || lpad(nextval('receipt_no_seq')::text, 5, '0'),
           $1::date,
           $2,
           $3,
           $4,
           $5,
           $6,
           $7::uuid
         )
         returning id, receipt_no, receipt_date::text as receipt_date, student_id, amount::text as amount, payment_mode, reference, narration, created_at`,
        [receiptDate, studentId, amount, paymentMode, reference ?? null, narration ?? null, auth.user.branchId],
      );

      const receipt = insertRes.rows[0] as { id: string; receipt_no: string };

      const ledgerCode =
        paymentMode === "cash"
          ? "CASH"
          : paymentMode === "upi"
            ? "UPI"
            : paymentMode === "card"
              ? "CARD"
              : "BANK";

      const voucherRes = await client.query(
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
         values ('Receipt', $1, $2::date, $3::uuid, $4, $5, 'receipt', $6::uuid, $7::uuid)
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
        [receipt.receipt_no, receiptDate, studentId, student.full_name, narration ?? null, receipt.id, auth.user.branchId],
      );

      const voucherId = voucherRes.rows[0]?.id as string;
      await client.query(`delete from accounting_voucher_lines where voucher_id = $1::uuid`, [voucherId]);

      await client.query(
        `insert into accounting_voucher_lines (voucher_id, ledger_code, debit, credit)
         values ($1::uuid, $2, $3, 0)`,
        [voucherId, ledgerCode, amount],
      );
      await client.query(
        `insert into accounting_voucher_lines (voucher_id, ledger_code, debit, credit)
         values ($1::uuid, 'DEBTORS_CTRL', 0, $2)`,
        [voucherId, amount],
      );

      await client.query("commit");
      return reply.code(201).send(insertRes.rows[0]);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  });
}
