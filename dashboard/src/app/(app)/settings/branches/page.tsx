"use client";

import { useEffect, useState } from "react";
import TopNav from "@/components/TopNav";
import { API_BASE_URL } from "@/lib/api";
import { getAuthToken } from "@/lib/auth";
import styles from "./branches.module.css";

type Branch = {
  id: string;
  name: string;
  code?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  is_active: boolean;
  is_default: boolean;
};

const emptyBranch = {
  name: "",
  code: "",
  address: "",
  phone: "",
  email: "",
  is_active: true,
  is_default: false,
};

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] = useState({ ...emptyBranch });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const activeCount = branches.filter((branch) => branch.is_active).length;

  function resetForm() {
    setEditingId(null);
    setForm({ ...emptyBranch });
    setMessage("");
  }

  function selectBranch(branch: Branch) {
    setEditingId(branch.id);
    setMessage("");
    setForm({
      name: branch.name || "",
      code: branch.code || "",
      address: branch.address || "",
      phone: branch.phone || "",
      email: branch.email || "",
      is_active: branch.is_active,
      is_default: branch.is_default,
    });
  }

  async function loadBranches() {
    const token = getAuthToken();
    if (!token) return;
    const res = await fetch(`${API_BASE_URL}/branches`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setBranches(Array.isArray(body.branches) ? body.branches : []);
  }

  useEffect(() => {
    void loadBranches();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const token = getAuthToken();
    if (!token) return;
    const url = editingId ? `${API_BASE_URL}/branches/${editingId}` : `${API_BASE_URL}/branches`;
    const res = await fetch(url, {
      method: editingId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(form),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(body.message || "Save failed");
      return;
    }
    setForm({ ...emptyBranch });
    setEditingId(null);
    setMessage("Saved.");
    await loadBranches();
  }

  return (
    <>
      <TopNav title="Branches" />
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <div className={styles.eyebrow}>Company access</div>
            <h1 className={styles.title}>Branch Management</h1>
            <p className={styles.subtitle}>Create branches, mark the primary location, and keep inactive locations out of daily operations.</p>
          </div>
          <button type="button" className={styles.btnGhost} onClick={resetForm}>
            New Branch
          </button>
        </div>

        <div className={styles.statsGrid}>
          <div className={styles.stat}>
            <span>Total branches</span>
            <strong>{branches.length}</strong>
          </div>
          <div className={styles.stat}>
            <span>Active branches</span>
            <strong>{activeCount}</strong>
          </div>
          <div className={styles.stat}>
            <span>Default branch</span>
            <strong>{branches.find((branch) => branch.is_default)?.name || "Not set"}</strong>
          </div>
        </div>

        <div className={styles.layout}>
          <form onSubmit={save} className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2 className={styles.panelTitle}>{editingId ? "Edit Branch" : "Create Branch"}</h2>
                <p className={styles.panelHint}>These details appear wherever branch selection or access control is shown.</p>
              </div>
              {editingId ? <span className={styles.badgeInfo}>Editing</span> : <span className={styles.badgeMuted}>New</span>}
            </div>

            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>Branch Name *</span>
                <input placeholder="e.g. Indira Nagar Library" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </label>
              <label className={styles.field}>
                <span>Branch Code</span>
                <input placeholder="e.g. INDLIB" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
              </label>
              <label className={styles.field}>
                <span>Phone</span>
                <input placeholder="Branch phone number" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </label>
              <label className={styles.field}>
                <span>Email</span>
                <input placeholder="branch@company.com" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </label>
            </div>

            <label className={styles.field}>
              <span>Address</span>
              <textarea placeholder="Complete branch address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} rows={4} />
            </label>

            <div className={styles.toggleGrid}>
              <label className={`${styles.toggleCard} ${form.is_active ? styles.toggleCardActive : ""}`}>
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
                <span>
                  <strong>Active branch</strong>
                  <small>Allow users to log in and operate here.</small>
                </span>
              </label>
              <label className={`${styles.toggleCard} ${form.is_default ? styles.toggleCardActive : ""}`}>
                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))} />
                <span>
                  <strong>Default branch</strong>
                  <small>Use as the primary location for new setup.</small>
                </span>
              </label>
            </div>

            <div className={styles.actions}>
              <button className={styles.btnPrimary} type="submit">{editingId ? "Save Branch" : "Create Branch"}</button>
              {editingId ? <button className={styles.btnOutline} type="button" onClick={resetForm}>Cancel</button> : null}
            </div>
            {message ? <div className={message === "Saved." ? styles.success : styles.error}>{message}</div> : null}
          </form>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2 className={styles.panelTitle}>All Branches</h2>
                <p className={styles.panelHint}>Select any branch to update its profile and availability.</p>
              </div>
            </div>

            {branches.length === 0 ? (
              <div className={styles.emptyState}>No branches have been created yet.</div>
            ) : (
              <div className={styles.branchList}>
                {branches.map((branch) => (
                  <button
                    key={branch.id}
                    type="button"
                    className={`${styles.branchRow} ${editingId === branch.id ? styles.branchRowActive : ""}`}
                    onClick={() => selectBranch(branch)}
                  >
                    <span className={styles.branchMain}>
                      <strong>{branch.name}</strong>
                      <small>{branch.address || branch.email || branch.phone || "No contact details added"}</small>
                    </span>
                    <span className={styles.branchMeta}>
                      <span className={styles.codePill}>{branch.code || "No code"}</span>
                      <span className={branch.is_active ? styles.badgeSuccess : styles.badgeMuted}>{branch.is_active ? "Active" : "Inactive"}</span>
                      {branch.is_default ? <span className={styles.badgeInfo}>Default</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
