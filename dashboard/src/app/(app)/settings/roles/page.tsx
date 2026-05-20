"use client";

import { useEffect, useMemo, useState } from "react";
import TopNav from "@/components/TopNav";
import { API_BASE_URL } from "@/lib/api";
import { getAuthToken } from "@/lib/auth";
import styles from "./roles.module.css";

type Permission = { code: string; label: string; module: string };
type Role = { id: string; name: string; description?: string | null; is_system: boolean; permissions: string[] };

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [editing, setEditing] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");

  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const permission of permissions) {
      const list = map.get(permission.module) ?? [];
      list.push(permission);
      map.set(permission.module, list);
    }
    return Array.from(map.entries());
  }, [permissions]);

  const selectedRoleName = editing ? editing.name : "New role";

  function resetForm() {
    setEditing(null);
    setName("");
    setDescription("");
    setSelected(new Set());
    setMessage("");
  }

  async function load() {
    const token = getAuthToken();
    if (!token) return;
    const [rolesRes, permissionsRes] = await Promise.all([
      fetch(`${API_BASE_URL}/roles`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API_BASE_URL}/permissions`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const rolesBody = await rolesRes.json().catch(() => ({}));
    const permissionsBody = await permissionsRes.json().catch(() => ({}));
    if (rolesRes.ok) setRoles(Array.isArray(rolesBody.roles) ? rolesBody.roles : []);
    if (permissionsRes.ok) setPermissions(Array.isArray(permissionsBody.permissions) ? permissionsBody.permissions : []);
  }

  useEffect(() => {
    void load();
  }, []);

  function editRole(role: Role) {
    setEditing(role);
    setName(role.name);
    setDescription(role.description || "");
    setSelected(new Set(role.permissions || []));
    setMessage("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const token = getAuthToken();
    if (!token) return;
    const url = editing ? `${API_BASE_URL}/roles/${editing.id}` : `${API_BASE_URL}/roles`;
    const res = await fetch(url, {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, description, permissions: Array.from(selected) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(body.message || "Save failed");
      return;
    }
    setEditing(null);
    setName("");
    setDescription("");
    setSelected(new Set());
    setMessage("Saved.");
    await load();
  }

  function togglePermission(code: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  return (
    <>
      <TopNav title="Roles & Permissions" />
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <div className={styles.eyebrow}>Security model</div>
            <h1 className={styles.title}>Roles & Permissions</h1>
            <p className={styles.subtitle}>Build reusable roles for admins, branch managers, counsellors, librarians, and account staff.</p>
          </div>
          <button type="button" className={styles.btnGhost} onClick={resetForm}>
            New Role
          </button>
        </div>

        <div className={styles.layout}>
          <div className={styles.rolesPanel}>
            <div className={styles.panelHeader}>
              <div>
                <h2 className={styles.panelTitle}>Role Library</h2>
                <p className={styles.panelHint}>{roles.length} roles configured</p>
              </div>
            </div>
            {roles.length === 0 ? (
              <div className={styles.emptyState}>No roles found.</div>
            ) : (
              <div className={styles.roleList}>
                {roles.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => editRole(role)}
                    className={`${styles.roleButton} ${editing?.id === role.id ? styles.roleButtonActive : ""}`}
                  >
                    <span className={styles.roleText}>
                      <strong>{role.name}</strong>
                      <small>{role.description || "No description added"}</small>
                    </span>
                    <span className={styles.roleMeta}>
                      {role.is_system ? <span className={styles.badgeInfo}>System</span> : null}
                      <span className={styles.badgeMuted}>{role.permissions.length} permissions</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={save} className={styles.editorPanel}>
            <div className={styles.panelHeader}>
              <div>
                <h2 className={styles.panelTitle}>{editing ? `Edit ${editing.name}` : "Create Role"}</h2>
                <p className={styles.panelHint}>Currently configuring {selectedRoleName} with {selected.size} selected permissions.</p>
              </div>
              {editing?.is_system ? <span className={styles.badgeInfo}>Protected name</span> : <span className={styles.badgeMuted}>Editable</span>}
            </div>

            <div className={styles.formArea}>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Role Name *</span>
                  <input placeholder="e.g. branch_manager" value={name} disabled={!!editing?.is_system} onChange={(e) => setName(e.target.value)} required />
                </label>
                <label className={styles.field}>
                  <span>Description</span>
                  <input placeholder="Short note about when to use this role" value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
              </div>

              <div className={styles.permissionHeader}>
                <div>
                  <h3>Permission Matrix</h3>
                  <p>Choose exactly what this role can view or change across the dashboard.</p>
                </div>
                <span className={styles.countPill}>{selected.size} selected</span>
              </div>

              {grouped.length === 0 ? (
                <div className={styles.emptyState}>Permissions are not available yet.</div>
              ) : (
                <div className={styles.permissionModules}>
                  {grouped.map(([module, list]) => {
                    const selectedInModule = list.filter((permission) => selected.has(permission.code)).length;
                    return (
                      <section key={module} className={styles.permissionModule}>
                        <div className={styles.moduleHeader}>
                          <div>
                            <h4>{module}</h4>
                            <p>{selectedInModule} of {list.length} enabled</p>
                          </div>
                        </div>
                        <div className={styles.permissionGrid}>
                          {list.map((permission) => {
                            const checked = selected.has(permission.code);
                            return (
                              <label key={permission.code} className={`${styles.permissionCard} ${checked ? styles.permissionCardActive : ""}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => togglePermission(permission.code, e.target.checked)}
                                />
                                <span>
                                  <strong>{permission.code}</strong>
                                  <small>{permission.label}</small>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </div>

            <div className={styles.actionBar}>
              <button className={styles.btnPrimary} type="submit">{editing ? "Save Role" : "Create Role"}</button>
              {editing ? <button className={styles.btnOutline} type="button" onClick={resetForm}>Cancel</button> : null}
              {message ? <div className={message === "Saved." ? styles.success : styles.error}>{message}</div> : null}
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
