"use client";

import { useEffect, useState } from "react";
import TopNav from "@/components/TopNav";
import styles from "./page.module.css";
import { AddStudentModal } from "@/components/modals/Modals";

import SeatStatus from "@/components/dashboard/SeatStatus";
import LockerStatus from "@/components/dashboard/LockerStatus";
import { API_BASE_URL } from "@/lib/api";
import { getAuthToken } from "@/lib/auth";
import { DEFAULT_BUSINESS_MODULES, normalizeBusinessModules, type BusinessModules } from "@/lib/businessModules";

type Seat = {
  id: string;
  seat_number: string;
  status: "available" | "occupied" | "maintenance";
};

type ShiftRow = {
  id: string;
  name: string;
};

type ClassRow = {
  id: string;
  name: string;
  status: string;
};

type LockerRow = {
  locker_number: number;
  assignment_id: string | null;
};

type BillingInvoiceRow = {
  id: string;
  invoiceNo: string;
  invoiceDate: string; // yyyy-mm-dd
  customerName: string;
  totalAmount: number;
  status: string;
  type: string;
  createdAt: string;
};

type ReceiptRow = {
  id: string;
  receiptNo: string;
  receiptDate: string; // yyyy-mm-dd
  studentName: string;
  amount: number;
  type: string;
  status: string;
  createdAt: string;
};

type RecentTransactionRow = {
  id: string;
  date: string;
  party: string;
  type: string;
  amount: number;
  status: string;
  sortKey: number;
};

function dateToSortKey(isoDate: string | null | undefined) {
  if (!isoDate) return 0;
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  return Number.isFinite(t) ? t : 0;
}

export default function Dashboard() {
  const [isStudentModalOpen, setIsStudentModalOpen] = useState(false);
  const [seatCounts, setSeatCounts] = useState<{ occupied: number; total: number }>({ occupied: 0, total: 0 });
  const [activeClassCount, setActiveClassCount] = useState<number>(0);
  const [lockerCounts, setLockerCounts] = useState<{ occupied: number; total: number }>({ occupied: 0, total: 0 });
  const [recentTransactions, setRecentTransactions] = useState<RecentTransactionRow[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState<boolean>(true);
  const [modules, setModules] = useState<BusinessModules>(DEFAULT_BUSINESS_MODULES);

  useEffect(() => {
    let cancelled = false;

    async function loadOverview() {
      try {
        const token = getAuthToken();
        if (!token) return;

        // Use shift-aware seats view so "occupied" reflects active check-ins.
        const shiftsRes = await fetch(`${API_BASE_URL}/library/shifts`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const shiftsBody = await shiftsRes.json().catch(() => null);
        const shifts = Array.isArray(shiftsBody) ? (shiftsBody as ShiftRow[]) : [];
        const shiftId = shifts[0]?.id || null;

        const seatsUrl = shiftId
          ? `${API_BASE_URL}/library/seats?shift_id=${encodeURIComponent(shiftId)}`
          : `${API_BASE_URL}/library/seats`;

        const [companyRes, seatsRes, classesRes, lockersRes, invoicesRes, receiptsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/company`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(seatsUrl, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_BASE_URL}/classes`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_BASE_URL}/library/lockers`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_BASE_URL}/billing/invoices?limit=5`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_BASE_URL}/receipts?limit=5`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        if (companyRes.ok) {
          const body = await companyRes.json().catch(() => null);
          if (!cancelled) setModules(normalizeBusinessModules(body?.business_modules));
        }

        if (seatsRes.ok) {
          const seats = (await seatsRes.json()) as Seat[];
          const total = Array.isArray(seats) ? seats.length : 0;
          const occupied = Array.isArray(seats) ? seats.filter((s) => s.status === "occupied").length : 0;
          if (!cancelled) setSeatCounts({ occupied, total });
        }

        if (classesRes.ok) {
          const classes = (await classesRes.json()) as ClassRow[];
          const active = Array.isArray(classes)
            ? classes.filter((c) => (c.status || "active").toLowerCase() === "active").length
            : 0;
          if (!cancelled) setActiveClassCount(active);
        }

        if (lockersRes.ok) {
          const lockers = (await lockersRes.json()) as LockerRow[];
          const total = Array.isArray(lockers) ? lockers.length : 0;
          const occupied = Array.isArray(lockers)
            ? lockers.filter((l) => Boolean(l.assignment_id)).length
            : 0;
          if (!cancelled) setLockerCounts({ occupied, total });
        }

        try {
          const [invoicesBody, receiptsBody] = await Promise.all([
            invoicesRes.ok ? invoicesRes.json().catch(() => null) : null,
            receiptsRes.ok ? receiptsRes.json().catch(() => null) : null,
          ]);

          const invoices = Array.isArray(invoicesBody) ? (invoicesBody as BillingInvoiceRow[]) : [];
          const receipts = Array.isArray(receiptsBody) ? (receiptsBody as ReceiptRow[]) : [];

          const mappedInvoices: RecentTransactionRow[] = invoices.map((r) => ({
            id: r.id,
            date: r.invoiceDate,
            party: r.customerName,
            type: r.type || "Sales Invoice",
            amount: Number.isFinite(r.totalAmount) ? r.totalAmount : Number(r.totalAmount ?? 0),
            status: r.status || "—",
            sortKey: dateToSortKey(r.invoiceDate) || Date.parse(r.createdAt ?? "") || 0,
          }));

          const mappedReceipts: RecentTransactionRow[] = receipts.map((r) => ({
            id: r.id,
            date: r.receiptDate,
            party: r.studentName,
            type: r.type || "Receipt",
            amount: Number.isFinite(r.amount) ? r.amount : Number(r.amount ?? 0),
            status: r.status || "Received",
            sortKey: dateToSortKey(r.receiptDate) || Date.parse(r.createdAt ?? "") || 0,
          }));

          const merged = [...mappedInvoices, ...mappedReceipts]
            .filter((r) => r.sortKey > 0)
            .sort((a, b) => b.sortKey - a.sortKey)
            .slice(0, 5);

          if (!cancelled) setRecentTransactions(merged);
        } finally {
          if (!cancelled) setTransactionsLoading(false);
        }
      } catch {
        // ignore; show empty states
        if (!cancelled) setTransactionsLoading(false);
      }
    }

    void loadOverview();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <TopNav />

        <div className={styles.content}>
          {/* Quick Actions / Promos */}
          <div className={styles.promoSection}>
            <div className={`${styles.promoCard} ${styles.bgTan}`}>
              <div className={styles.promoText}>
                <h3>New Admission</h3>
                <p>Register a new student for the enabled institute modules</p>
                <button
                  className={styles.linkButton}
                  onClick={() => setIsStudentModalOpen(true)}
                >
                  + Register Now &rarr;
                </button>
              </div>
              <div className={styles.promoImage}>📝</div>
            </div>

            {modules.billing ? (
            <div className={`${styles.promoCard} ${styles.bgGreen}`}>
              <div className={styles.promoText}>
                <h3>Create Invoice</h3>
                <p>Generate fee receipt or sales invoice quickly</p>
                <button className={`${styles.linkButton} ${styles.textGreen}`} onClick={() => { window.location.href = "/billing/create"; }}>
                  + Create New &rarr;
                </button>
              </div>
              <div className={styles.promoImage}>🧾</div>
            </div>
            ) : null}
          </div>

          {/* Business Overview Header */}
          <div className={styles.sectionHeader}>
            <h3>Overview</h3>
            <span className={styles.timestamp}>Last Update: —</span>
          </div>

          {/* Stats Cards */}
          <div className={styles.statsGrid}>
            {modules.selfStudyLibrary ? (
            <div className={`${styles.statWrapper} ${styles.bgBlueLight}`}>
              <span className={styles.statLabel}>📚 Library Seats</span>
              <div className={styles.statValue}>
                {seatCounts.occupied}
                <span style={{ fontSize: "1rem", color: "#64748b" }}>/
                  {seatCounts.total}
                </span>
              </div>
            </div>
            ) : null}
            {modules.lockers ? (
            <div className={`${styles.statWrapper} ${styles.bgBlueLight}`}>
              <span className={styles.statLabel}>🔒 Lockers</span>
              <div className={styles.statValue}>
                {lockerCounts.occupied}
                <span style={{ fontSize: "1rem", color: "#64748b" }}>/
                  {lockerCounts.total}
                </span>
              </div>
            </div>
            ) : null}
            {(modules.coaching || modules.school) ? (
            <div className={`${styles.statWrapper} ${styles.bgBlueLight}`}>
              <span className={styles.statLabel}>🎓 Coaching Batches</span>
              <div className={styles.statValue}>
                {activeClassCount}{" "}
                <span style={{ fontSize: "1rem", color: "#64748b" }}>Active</span>
              </div>
            </div>
            ) : null}
            {modules.billing ? (
            <div className={`${styles.statWrapper} ${styles.bgGreenLight}`}>
              <span className={styles.statLabel}>↓ Today&apos;s Collection</span>
              <div className={styles.statValue}>—</div>
            </div>
            ) : null}
            {modules.billing ? (
            <div className={`${styles.statWrapper} ${styles.bgRedLight}`}>
              <span className={styles.statLabel}>⚠️ Pending Dues</span>
              <div className={styles.statValue}>—</div>
            </div>
            ) : null}
          </div>

          {/* Content Details Grid */}
          <div className={styles.detailsGrid}>
            {/* Recent Fees/Transactions */}
            <div className={styles.transactionsCard}>
              <div className={styles.cardHeader}>
                <h3>Recent Transactions</h3>
              </div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>DATE</th>
                    <th>STUDENT / PARTY</th>
                    <th>TYPE</th>
                    <th>AMOUNT</th>
                    <th>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTransactions.map((t) => (
                    <tr key={t.id}>
                      <td>{t.date || "—"}</td>
                      <td>{t.party || "—"}</td>
                      <td>{t.type || "—"}</td>
                      <td>₹ {Number.isFinite(t.amount) ? t.amount.toFixed(2) : "0.00"}</td>
                      <td>{t.status || "—"}</td>
                    </tr>
                  ))}

                  {transactionsLoading && recentTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: "1.5rem", textAlign: "center", color: "#64748b" }}>
                        Loading...
                      </td>
                    </tr>
                  ) : null}

                  {!transactionsLoading && recentTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: "1.5rem", textAlign: "center", color: "#64748b" }}>
                        No transactions yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className={styles.sideWidgets}>
              {/* Seat Status Widget */}
              {modules.selfStudyLibrary ? <SeatStatus /> : null}

              {/* Locker Status Widget */}
              {modules.lockers ? <LockerStatus /> : null}
            </div>
          </div>
        </div>

        {/* Modals */}
        <AddStudentModal
          isOpen={isStudentModalOpen}
          onClose={() => setIsStudentModalOpen(false)}
          availableClasses={[]}
        />
    </>
  );
}
