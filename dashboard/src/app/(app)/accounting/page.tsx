"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TopNav from "@/components/TopNav";
import UniversalModal from "@/components/modals/UniversalModal";
import modalStyles from "@/components/modals/Modal.module.css";
import styles from "./accounting.module.css";
import { API_BASE_URL } from "@/lib/api";
import { clearAuthToken, getAuthToken } from "@/lib/auth";

type Doc = { name: string; url: string; uploaded_at?: string };

type Expense = {
  id: string;
  expenseNo: string;
  expenseDate: string;
  payeeName?: string | null;
  amount: number;
  paymentMode: string;
  ledgerCode: string;
  reference?: string | null;
  narration?: string | null;
  documents?: Doc[] | null;
  createdAt: string;
  voucherNo?: string | null;
};

type Purchase = {
  id: string;
  purchaseNo: string;
  purchaseDate: string;
  vendorName: string;
  amount: number;
  paymentMode: string;
  liabilityLedgerCode?: string | null;
  reference?: string | null;
  narration?: string | null;
  documents?: Doc[] | null;
  createdAt: string;
};

type Ledger = {
  code: string;
  name: string;
  nature: "asset" | "liability" | "income" | "expense" | string;
};

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function resolvePublicUrl(url: string): string {
  const u = url.trim();
  if (!u) return u;
  if (/^(https?:\/\/|data:|blob:)/i.test(u)) return u;
  if (u.startsWith("/")) return `${API_BASE_URL}${u}`;
  return `${API_BASE_URL}/${u}`;
}

const EXPENSE_CATEGORIES: Array<{ code: string; label: string }> = [
  { code: "EXP_ELECTRICITY", label: "Electricity" },
  { code: "EXP_WIFI", label: "WiFi / Internet" },
  { code: "EXP_MAINTENANCE", label: "Maintenance" },
  { code: "EXP_SALARIES", label: "Salary" },
  { code: "EXPENSE_MISC", label: "Other" },
];

export default function AccountingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const token = useMemo(() => getAuthToken(), []);

  const tab = useMemo(() => {
    const t = (searchParams?.get("tab") || "").toLowerCase();
    if (t === "purchases" || t === "expenses") return t;
    return "expenses";
  }, [searchParams]);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [loadingExpenses, setLoadingExpenses] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  const [loadingPurchases, setLoadingPurchases] = useState(false);
  const [purchases, setPurchases] = useState<Purchase[]>([]);

  const [loadingLiabilityLedgers, setLoadingLiabilityLedgers] = useState(false);
  const [liabilityLedgers, setLiabilityLedgers] = useState<Ledger[]>([]);

  // Expense modal state
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [expenseDate, setExpenseDate] = useState(todayISO());
  const [expenseCategory, setExpenseCategory] = useState("EXP_ELECTRICITY");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expensePaymentMode, setExpensePaymentMode] = useState("cash");
  const [expensePayee, setExpensePayee] = useState("");
  const [expenseReference, setExpenseReference] = useState("");
  const [expenseNarration, setExpenseNarration] = useState("");
  const [expenseFiles, setExpenseFiles] = useState<File[]>([]);

  // Purchase modal state
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [purchaseDate, setPurchaseDate] = useState(todayISO());
  const [purchaseVendor, setPurchaseVendor] = useState("");
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [purchasePaymentMode, setPurchasePaymentMode] = useState("cash");
  const [purchaseLiabilityLedgerCode, setPurchaseLiabilityLedgerCode] = useState<string>("LOAN_PAYABLE");
  const [purchaseReference, setPurchaseReference] = useState("");
  const [purchaseNarration, setPurchaseNarration] = useState("");
  const [purchaseFiles, setPurchaseFiles] = useState<File[]>([]);

  // Loan account (ledger) modal state
  const [loanOpen, setLoanOpen] = useState(false);
  const [loanSaving, setLoanSaving] = useState(false);
  const [loanName, setLoanName] = useState("");
  const [resumePurchaseAfterLoan, setResumePurchaseAfterLoan] = useState(false);

  function setTab(next: "expenses" | "purchases") {
    router.replace(`/accounting?tab=${encodeURIComponent(next)}`);
  }

  async function authedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const t = getAuthToken();
    if (!t) throw new Error("Not logged in");
    const res = await fetch(input, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${t}`,
      },
    });
    if (res.status === 401) {
      clearAuthToken();
      throw new Error("Unauthorized");
    }
    return res;
  }

  async function loadExpenses() {
    setLoadingExpenses(true);
    try {
      const res = await authedFetch(`${API_BASE_URL}/accounting/expenses?limit=100&offset=0`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load expenses");
      }
      const body = await res.json().catch(() => ([]));
      setExpenses(Array.isArray(body) ? (body as Expense[]) : []);
    } finally {
      setLoadingExpenses(false);
    }
  }

  async function loadPurchases() {
    setLoadingPurchases(true);
    try {
      const res = await authedFetch(`${API_BASE_URL}/purchases?limit=100&offset=0`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load purchases");
      }
      const body = await res.json().catch(() => ([]));
      setPurchases(Array.isArray(body) ? (body as Purchase[]) : []);
    } finally {
      setLoadingPurchases(false);
    }
  }

  async function loadLiabilityLedgers() {
    setLoadingLiabilityLedgers(true);
    try {
      const res = await authedFetch(`${API_BASE_URL}/accounting/ledgers?nature=liability&limit=500&offset=0`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load ledgers");
      }
      const body = await res.json().catch(() => ([]));
      const list = Array.isArray(body) ? (body as Ledger[]) : [];
      setLiabilityLedgers(list);

      if (list.length > 0) {
        const hasSelected = list.some((l) => l.code === purchaseLiabilityLedgerCode);
        if (!hasSelected) setPurchaseLiabilityLedgerCode(list[0]!.code);
      }
    } finally {
      setLoadingLiabilityLedgers(false);
    }
  }

  useEffect(() => {
    if (!token) return;

    // Lazy-load per tab for speed.
    (async () => {
      try {
        setError(null);
        setSuccess(null);

        if (tab === "expenses") await loadExpenses();
        if (tab === "purchases") {
          await Promise.all([loadPurchases(), loadLiabilityLedgers()]);
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tab]);

  useEffect(() => {
    if (purchasePaymentMode !== "credit") return;
    if (liabilityLedgers.length === 0) return;
    const hasSelected = liabilityLedgers.some((l) => l.code === purchaseLiabilityLedgerCode);
    if (!hasSelected) setPurchaseLiabilityLedgerCode(liabilityLedgers[0]!.code);
  }, [purchasePaymentMode, liabilityLedgers, purchaseLiabilityLedgerCode]);

  async function submitLoanLedger(e: React.FormEvent) {
    e.preventDefault();
    setLoanSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (!loanName.trim()) throw new Error("Loan account name is required");

      const res = await authedFetch(`${API_BASE_URL}/accounting/ledgers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: loanName.trim(),
          nature: "liability",
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Failed to create loan account");

      const createdCode = String(body.code || "");

      setLoanOpen(false);
      setLoanName("");
      setResumePurchaseAfterLoan(false);

      setSuccess("Loan account created.");
      await loadLiabilityLedgers();
      if (createdCode) setPurchaseLiabilityLedgerCode(createdCode);
      setPurchaseOpen(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoanSaving(false);
    }
  }

  async function submitExpense(e: React.FormEvent) {
    e.preventDefault();
    setExpenseSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const amt = Number(expenseAmount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Amount must be a positive number");

      const res = await authedFetch(`${API_BASE_URL}/accounting/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expenseDate,
          amount: amt,
          paymentMode: expensePaymentMode,
          ledgerCode: expenseCategory,
          payeeName: expensePayee.trim() ? expensePayee.trim() : null,
          reference: expenseReference.trim() ? expenseReference.trim() : null,
          narration: expenseNarration.trim() ? expenseNarration.trim() : null,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Failed to save expense");

      const createdId = String(body.id || "");

      if (createdId && expenseFiles.length > 0) {
        const fd = new FormData();
        for (const f of expenseFiles) fd.append("files", f);

        const up = await authedFetch(`${API_BASE_URL}/accounting/expenses/${createdId}/documents`, {
          method: "POST",
          body: fd,
        });
        const upBody = await up.json().catch(() => ({}));
        if (!up.ok) throw new Error(upBody.message || "Failed to upload bill");
      }

      setExpenseOpen(false);
      setExpenseAmount("");
      setExpensePayee("");
      setExpenseReference("");
      setExpenseNarration("");
      setExpenseFiles([]);

      setSuccess("Expense saved.");
      await loadExpenses();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExpenseSaving(false);
    }
  }

  async function submitPurchase(e: React.FormEvent) {
    e.preventDefault();
    setPurchaseSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const amt = Number(purchaseAmount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Amount must be a positive number");
      if (!purchaseVendor.trim()) throw new Error("Vendor / Party name is required");

      const res = await authedFetch(`${API_BASE_URL}/purchases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseDate,
          vendorName: purchaseVendor.trim(),
          amount: amt,
          paymentMode: purchasePaymentMode,
          liabilityLedgerCode: purchasePaymentMode === "credit" ? purchaseLiabilityLedgerCode : null,
          reference: purchaseReference.trim() ? purchaseReference.trim() : null,
          narration: purchaseNarration.trim() ? purchaseNarration.trim() : null,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Failed to create purchase");

      const createdId = String(body.id || "");

      if (createdId && purchaseFiles.length > 0) {
        const fd = new FormData();
        for (const f of purchaseFiles) fd.append("files", f);

        const up = await authedFetch(`${API_BASE_URL}/purchases/${createdId}/documents`, {
          method: "POST",
          body: fd,
        });
        const upBody = await up.json().catch(() => ({}));
        if (!up.ok) throw new Error(upBody.message || "Failed to upload bill");
      }

      setPurchaseOpen(false);
      setPurchaseVendor("");
      setPurchaseAmount("");
      setPurchaseReference("");
      setPurchaseNarration("");
      setPurchaseFiles([]);

      setSuccess("Asset purchase saved.");
      await loadPurchases();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPurchaseSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <TopNav title="Accounting" />

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${tab === "expenses" ? styles.tabActive : ""}`}
          onClick={() => setTab("expenses")}
        >
          Expenses
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === "purchases" ? styles.tabActive : ""}`}
          onClick={() => setTab("purchases")}
        >
          Purchases
        </button>
      </div>

      {tab === "expenses" && (
        <div className={styles.card}>
          <div className={styles.headerRow}>
            <div>
              <div style={{ fontWeight: 800, color: "#0f172a" }}>Expenses</div>
              <div className={styles.muted}>Electricity / WiFi / Maintenance / Salary / Other. Posts vouchers automatically.</div>
            </div>
            <div className={styles.actions}>
              <button className={styles.button} type="button" onClick={() => setExpenseOpen(true)}>
                + Add Expense
              </button>
            </div>
          </div>

          <div className={styles.tableWrap}>
            {loadingExpenses ? (
              <div className={styles.muted}>Loading…</div>
            ) : expenses.length === 0 ? (
              <div className={styles.muted}>No expenses yet.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>No</th>
                    <th>Category</th>
                    <th>Payee</th>
                    <th>Mode</th>
                    <th>Amount</th>
                    <th>Bill</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((x) => (
                    <tr key={x.id}>
                      <td>{x.expenseDate}</td>
                      <td>{x.expenseNo}</td>
                      <td>{EXPENSE_CATEGORIES.find((c) => c.code === x.ledgerCode)?.label || x.ledgerCode}</td>
                      <td>{x.payeeName || "-"}</td>
                      <td>{x.paymentMode}</td>
                      <td>{x.amount}</td>
                      <td>
                        {x.documents && x.documents.length > 0 ? (
                          x.documents.map((d, idx) => (
                            <div key={idx}>
                              <a className={styles.docLink} href={resolvePublicUrl(d.url)} target="_blank" rel="noreferrer">
                                {d.name || "Bill"}
                              </a>
                            </div>
                          ))
                        ) : (
                          <span className={styles.muted}>-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "purchases" && (
        <div className={styles.card}>
          <div className={styles.headerRow}>
            <div>
              <div style={{ fontWeight: 800, color: "#0f172a" }}>Purchases (Assets)</div>
              <div className={styles.muted}>Dr Fixed Assets, Cr Cash/Bank/UPI/Card. Attach bill PDF/image.</div>
            </div>
            <div className={styles.actions}>
              <button
                className={styles.button}
                type="button"
                onClick={() => {
                  setPurchaseOpen(true);
                  if (liabilityLedgers.length === 0) {
                    loadLiabilityLedgers().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
                  }
                }}
              >
                + Add Purchase
              </button>
            </div>
          </div>

          <div className={styles.tableWrap}>
            {loadingPurchases ? (
              <div className={styles.muted}>Loading…</div>
            ) : purchases.length === 0 ? (
              <div className={styles.muted}>No purchases yet.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>No</th>
                    <th>Vendor</th>
                    <th>Mode</th>
                    <th>Amount</th>
                    <th>Bill</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((x) => (
                    <tr key={x.id}>
                      <td>{x.purchaseDate}</td>
                      <td>{x.purchaseNo}</td>
                      <td>{x.vendorName}</td>
                      <td>{x.paymentMode}</td>
                      <td>{x.amount}</td>
                      <td>
                        {x.documents && x.documents.length > 0 ? (
                          x.documents.map((d, idx) => (
                            <div key={idx}>
                              <a className={styles.docLink} href={resolvePublicUrl(d.url)} target="_blank" rel="noreferrer">
                                {d.name || "Bill"}
                              </a>
                            </div>
                          ))
                        ) : (
                          <span className={styles.muted}>-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.success}>{success}</div>}

      <UniversalModal
        isOpen={expenseOpen}
        title="Add Expense"
        onClose={() => {
          if (expenseSaving) return;
          setExpenseOpen(false);
        }}
        onSubmit={submitExpense}
        primaryLabel={expenseSaving ? "Saving…" : "Save"}
        primaryDisabled={expenseSaving}
      >
        <div className={modalStyles.inputGroup}>
          <label className={modalStyles.label}>Expense Date *</label>
          <input className={modalStyles.input} type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} required />
        </div>

        <div className={modalStyles.inputGroup}>
          <label className={modalStyles.label}>Category *</label>
          <select className={modalStyles.select} value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className={modalStyles.inputGroup}>
          <label className={modalStyles.label}>Amount *</label>
          <input className={modalStyles.input} value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} inputMode="decimal" placeholder="e.g. 1200" required />
        </div>

        <div className={modalStyles.inputGroup}>
          <label className={modalStyles.label}>Payment Mode *</label>
          <select className={modalStyles.select} value={expensePaymentMode} onChange={(e) => setExpensePaymentMode(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div className={modalStyles.inputGroup}>
          <label className={modalStyles.label}>Payee (optional)</label>
          <input className={modalStyles.input} value={expensePayee} onChange={(e) => setExpensePayee(e.target.value)} placeholder="e.g. Electricity board" />
        </div>

        <div className={modalStyles.inputGroup}>
          <label className={modalStyles.label}>Reference (optional)</label>
          <input className={modalStyles.input} value={expenseReference} onChange={(e) => setExpenseReference(e.target.value)} placeholder="Invoice no / txn id" />
        </div>

        <div className={modalStyles.inputGroup}>
          <label className={modalStyles.label}>Narration (optional)</label>
          <input className={modalStyles.input} value={expenseNarration} onChange={(e) => setExpenseNarration(e.target.value)} placeholder="e.g. April electricity bill" />
        </div>

        <div className={modalStyles.inputGroup}>
          <label className={modalStyles.label}>Attach Bill (PDF/Image)</label>
          <input
            className={modalStyles.input}
            type="file"
            multiple
            accept="application/pdf,image/*"
            onChange={(e) => setExpenseFiles(e.target.files ? Array.from(e.target.files) : [])}
          />
          {expenseFiles.length > 0 && <div className={styles.muted}>{expenseFiles.length} file(s) selected</div>}
        </div>
      </UniversalModal>

      <UniversalModal
        isOpen={purchaseOpen}
        title="Add Asset Purchase"
        onClose={() => {
          if (purchaseSaving) return;
          setPurchaseOpen(false);
        }}
        onSubmit={submitPurchase}
        primaryLabel={purchaseSaving ? "Saving…" : "Save"}
        primaryDisabled={purchaseSaving}
      >
        <div className={modalStyles.inputGroup}>
          <label className={modalStyles.label}>Purchase Date *</label>
          <input className={modalStyles.input} type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required />
        </div>

        <div className={modalStyles.inputGroup}>
          <label className={modalStyles.label}>Vendor / Party Name *</label>
          <input className={modalStyles.input} value={purchaseVendor} onChange={(e) => setPurchaseVendor(e.target.value)} required />
        </div>

        <div className={modalStyles.inputGroup}>
          <label className={modalStyles.label}>Amount *</label>
          <input className={modalStyles.input} value={purchaseAmount} onChange={(e) => setPurchaseAmount(e.target.value)} inputMode="decimal" required />
        </div>

        <div className={modalStyles.inputGroup}>
          <label className={modalStyles.label}>Payment Mode *</label>
          <select className={modalStyles.select} value={purchasePaymentMode} onChange={(e) => setPurchasePaymentMode(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
            <option value="credit">Credit / Loan</option>
          </select>
        </div>

        {purchasePaymentMode === "credit" && (
          <div className={modalStyles.inputGroup}>
            <label className={modalStyles.label}>Liability Ledger *</label>
            <select
              className={modalStyles.select}
              value={purchaseLiabilityLedgerCode}
              onChange={(e) => setPurchaseLiabilityLedgerCode(e.target.value)}
              disabled={loadingLiabilityLedgers}
            >
              {liabilityLedgers.length === 0 ? (
                <option value="LOAN_PAYABLE">Loan Payable</option>
              ) : (
                liabilityLedgers.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))
              )}
            </select>
            <div className={styles.muted}>
              Accounting entry: Dr Fixed Assets, Cr selected liability ledger.
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonSecondary}`}
                onClick={() => {
                  setResumePurchaseAfterLoan(true);
                  setPurchaseOpen(false);
                  setLoanName("");
                  setLoanOpen(true);
                }}
              >
                + Open Loan Account
              </button>
            </div>
          </div>
        )}

        <div className={modalStyles.inputGroup}>
          <label className={modalStyles.label}>Reference (optional)</label>
          <input className={modalStyles.input} value={purchaseReference} onChange={(e) => setPurchaseReference(e.target.value)} placeholder="Invoice no / txn id" />
        </div>

        <div className={modalStyles.inputGroup}>
          <label className={modalStyles.label}>Narration (optional)</label>
          <input className={modalStyles.input} value={purchaseNarration} onChange={(e) => setPurchaseNarration(e.target.value)} placeholder="e.g. Laptop for office" />
        </div>

        <div className={modalStyles.inputGroup}>
          <label className={modalStyles.label}>Attach Bill (PDF/Image)</label>
          <input
            className={modalStyles.input}
            type="file"
            multiple
            accept="application/pdf,image/*"
            onChange={(e) => setPurchaseFiles(e.target.files ? Array.from(e.target.files) : [])}
          />
          {purchaseFiles.length > 0 && <div className={styles.muted}>{purchaseFiles.length} file(s) selected</div>}
        </div>
      </UniversalModal>

      <UniversalModal
        isOpen={loanOpen}
        title="Open Loan Account"
        onClose={() => {
          if (loanSaving) return;
          setLoanOpen(false);
          if (resumePurchaseAfterLoan) setPurchaseOpen(true);
          setResumePurchaseAfterLoan(false);
        }}
        onSubmit={submitLoanLedger}
        primaryLabel={loanSaving ? "Saving…" : "Save"}
        primaryDisabled={loanSaving}
      >
        <div className={modalStyles.inputGroup}>
          <label className={modalStyles.label}>Loan Account Name *</label>
          <input
            className={modalStyles.input}
            value={loanName}
            onChange={(e) => setLoanName(e.target.value)}
            placeholder="e.g. Car Loan - HDFC"
            required
          />
          <div className={styles.muted}>This creates a liability ledger you can select for Credit / Loan purchases.</div>
        </div>
      </UniversalModal>
    </div>
  );
}
