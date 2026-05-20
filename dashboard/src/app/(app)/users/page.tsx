"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import TopNav from '@/components/TopNav';
import styles from './page.module.css';
import { AddUserModal, EditUserModal } from '@/components/modals/Modals';
import { API_BASE_URL } from '@/lib/api';
import { clearAuthToken, getAuthToken } from '@/lib/auth';

type User = {
  id: string;
  username: string;
  email: string;
  original_name?: string;
  first_name?: string;
  last_name?: string;
  address?: string;
  phone?: string;
  alternate_phone?: string;
  pan?: string;
  aadhar?: string;
  documents?: Array<{ name: string; type: string; size: number; lastModified: number }>;
  branch_access?: Array<{ branch_id: string; branch_name?: string; role_id: string; role_name?: string; is_active: boolean }>;
  role: string;
  is_active?: boolean;
  created_at: string;
};

const LEGACY_STORAGE_KEY = 'aedify.users';

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [meRole, setMeRole] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [roles, setRoles] = useState<Array<{ id: string; name: string }>>([]);

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      const at = new Date(a.created_at).getTime();
      const bt = new Date(b.created_at).getTime();
      return bt - at;
    });
  }, [users]);

  async function loadUsers() {
    const token = getAuthToken();
    if (!token) {
      router.replace('/auth/login');
      return;
    }

    const res = await fetch(`${API_BASE_URL}/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      clearAuthToken();
      router.replace('/auth/login');
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || 'Failed to load users');
    }

    const body = await res.json();
    setUsers(Array.isArray(body) ? (body as User[]) : []);
  }

  async function loadMe() {
    const token = getAuthToken();
    if (!token) return;
    const res = await fetch(`${API_BASE_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const body = (await res.json().catch(() => null)) as { id?: string; role?: string } | null;
    if (body?.id) setMeId(body.id);
    if (body?.role) setMeRole(body.role);
  }

  async function loadAccessOptions() {
    const token = getAuthToken();
    if (!token) return;
    const [branchesRes, rolesRes] = await Promise.all([
      fetch(`${API_BASE_URL}/branches`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API_BASE_URL}/roles`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const branchesBody = await branchesRes.json().catch(() => ({}));
    const rolesBody = await rolesRes.json().catch(() => ({}));
    if (branchesRes.ok) {
      const rows = Array.isArray(branchesBody.branches) ? branchesBody.branches : [];
      setBranches(rows.map((b: { id: string; name: string }) => ({ id: b.id, name: b.name })));
    }
    if (rolesRes.ok) {
      const rows = Array.isArray(rolesBody.roles) ? rolesBody.roles : [];
      setRoles(rows.map((r: { id: string; name: string }) => ({ id: r.id, name: r.name })));
    }
  }

  async function deleteUser(userId: string) {
    const token = getAuthToken();
    if (!token) {
      router.replace('/auth/login');
      return;
    }

    setDeletingUser(true);
    try {
      const res = await fetch(`${API_BASE_URL}/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearAuthToken();
        router.replace('/auth/login');
        return;
      }
      if (!res.ok) throw new Error(body.message || 'Failed to delete user');

      setEditingUser(null);
      await loadUsers();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      alert(message);
    } finally {
      setDeletingUser(false);
    }
  }

  async function saveUserEdits(payload: {
    id: string;
    username: string;
    email: string;
    role: string;
    is_active: boolean;
    original_name: string;
    first_name: string;
    last_name: string;
    address: string;
    phone: string;
    alternate_phone: string;
    pan: string;
    aadhar: string;
    documents: Array<{ name: string; type: string; size: number; lastModified: number }>;
    branch_access?: Array<{ branch_id: string; role_id: string; is_active: boolean }>;
  }) {
    const token = getAuthToken();
    if (!token) {
      router.replace('/auth/login');
      return;
    }

    // UI guardrails (server enforces these too)
    if (meId && payload.id === meId && payload.is_active === false) {
      alert("You can't deactivate your own account");
      return;
    }

    const activeAdminCount = users.filter((u) => u.is_active !== false && (u.role === 'admin' || u.role === 'owner'))
      .length;
    const isPrivilegedAfter = payload.role === 'admin' || payload.role === 'owner';
    const isActivePrivilegedAfter = isPrivilegedAfter && payload.is_active === true;
    const isLastActiveAdminRow =
      activeAdminCount <= 1 &&
      editingUser?.id === payload.id &&
      (editingUser.role === 'admin' || editingUser.role === 'owner') &&
      editingUser.is_active !== false;

    if (isLastActiveAdminRow && !isActivePrivilegedAfter) {
      alert('At least one active admin/owner must remain');
      return;
    }

    setSavingEdit(true);
    try {
      const res = await fetch(`${API_BASE_URL}/users/${payload.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          username: payload.username,
          email: payload.email,
          role: payload.role,
          is_active: payload.is_active,
          original_name: payload.original_name,
          first_name: payload.first_name,
          last_name: payload.last_name,
          address: payload.address,
          phone: payload.phone,
          alternate_phone: payload.alternate_phone,
          pan: payload.pan,
          aadhar: payload.aadhar,
          documents: payload.documents,
          branch_access: payload.branch_access,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearAuthToken();
        router.replace('/auth/login');
        return;
      }
      if (!res.ok) throw new Error(body.message || 'Failed to update user');

      setEditingUser(null);
      await loadUsers();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      alert(message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function importLegacyUsersIfAny() {
    if (typeof window === 'undefined') return;
    const token = getAuthToken();
    if (!token) return;

    // Load existing users once so we can merge legacy fields if a user already exists.
    let existingUsers: User[] = [];
    try {
      const res = await fetch(`${API_BASE_URL}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const body = await res.json().catch(() => ([]));
        existingUsers = Array.isArray(body) ? (body as User[]) : [];
      }
    } catch {
      existingUsers = [];
    }

    const byUsername = new Map<string, User>();
    const byEmail = new Map<string, User>();
    for (const u of existingUsers) {
      if (u.username) byUsername.set(u.username.toLowerCase(), u);
      if (u.email) byEmail.set(u.email.toLowerCase(), u);
    }

    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return;

    let hadSuccessOrConflict = false;

    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const u = entry as Record<string, unknown>;
      const username = typeof u.username === 'string' ? u.username.trim() : '';
      const email = typeof u.email === 'string' ? u.email.trim() : '';
      const password = typeof u.default_password === 'string' ? u.default_password : '';
      if (!username || !email || !password) continue;

      const payload = {
        username,
        email,
        password,
        role: typeof u.role === 'string' ? u.role : 'user',
        original_name: typeof u.original_name === 'string' ? u.original_name : '',
        first_name: typeof u.first_name === 'string' ? u.first_name : '',
        last_name: typeof u.last_name === 'string' ? u.last_name : '',
        address: typeof u.address === 'string' ? u.address : '',
        phone: typeof u.phone === 'string' ? u.phone : '',
        alternate_phone: typeof u.alternate_phone === 'string' ? u.alternate_phone : '',
        pan: typeof u.pan === 'string' ? u.pan : '',
        aadhar: typeof u.aadhar === 'string' ? u.aadhar : '',
        documents: Array.isArray(u.documents) ? u.documents : [],
      };

      try {
        const res = await fetch(`${API_BASE_URL}/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          hadSuccessOrConflict = true;
          continue;
        }

        if (res.status === 409) {
          // Merge legacy fields into existing user where possible.
          const existing = byUsername.get(username.toLowerCase()) || byEmail.get(email.toLowerCase());
          if (existing?.id) {
            const pickNonEmpty = (current: unknown, legacyValue: unknown) => {
              const cur = typeof current === 'string' ? current.trim() : '';
              const leg = typeof legacyValue === 'string' ? legacyValue.trim() : '';
              return cur ? cur : leg;
            };

            const mergedDocuments =
              Array.isArray(existing.documents) && existing.documents.length > 0
                ? existing.documents
                : (payload.documents as Array<{ name: string; type: string; size: number; lastModified: number }>);

            const putRes = await fetch(`${API_BASE_URL}/users/${existing.id}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                username: existing.username,
                email: existing.email,
                role: existing.role,
                is_active: existing.is_active !== false,
                original_name: pickNonEmpty(existing.original_name, payload.original_name),
                first_name: pickNonEmpty(existing.first_name, payload.first_name),
                last_name: pickNonEmpty(existing.last_name, payload.last_name),
                address: pickNonEmpty(existing.address, payload.address),
                phone: pickNonEmpty(existing.phone, payload.phone),
                alternate_phone: pickNonEmpty(existing.alternate_phone, payload.alternate_phone),
                pan: pickNonEmpty(existing.pan, payload.pan),
                aadhar: pickNonEmpty(existing.aadhar, payload.aadhar),
                documents: mergedDocuments,
              }),
            });

            if (putRes.ok) {
              hadSuccessOrConflict = true;
            } else {
              // Even if merge fails, avoid blocking the rest of the import.
              hadSuccessOrConflict = true;
            }
          } else {
            hadSuccessOrConflict = true;
          }
        }
      } catch {
        // ignore
      }
    }

    if (hadSuccessOrConflict) {
      try {
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadMe();
        await loadAccessOptions();
        await importLegacyUsersIfAny();
        await loadUsers();
      } catch (err) {
        // Keep the page usable even if the API is down.
        // eslint-disable-next-line no-console
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCreateUser(payload: {
    username: string;
    email: string;
    default_password: string;
    original_name: string;
    first_name: string;
    last_name: string;
    address: string;
    phone: string;
    alternate_phone: string;
    pan: string;
    aadhar: string;
    documents: Array<{ name: string; type: string; size: number; lastModified: number }>;
    role: string;
    branch_access?: Array<{ branch_id: string; role_id: string; is_active: boolean }>;
  }) {
    (async () => {
      const token = getAuthToken();
      if (!token) {
        router.replace('/auth/login');
        return;
      }

      const username = payload.username.trim();
      const email = payload.email.trim();
      const password = payload.default_password;

      if (!username || !email || !password) {
        alert('Username, Email, and Default Password are required');
        return;
      }

      try {
        const res = await fetch(`${API_BASE_URL}/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            username,
            email,
            password,
            role: payload.role,
            original_name: payload.original_name,
            first_name: payload.first_name,
            last_name: payload.last_name,
            address: payload.address,
            phone: payload.phone,
            alternate_phone: payload.alternate_phone,
            pan: payload.pan,
            aadhar: payload.aadhar,
            documents: payload.documents,
            branch_access: payload.branch_access,
          }),
        });

        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          clearAuthToken();
          router.replace('/auth/login');
          return;
        }
        if (!res.ok) throw new Error(body.message || 'Failed to create user');

        await loadUsers();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        alert(message);
      } finally {
      }
    })();
  }

  return (
    <>
      <TopNav title="Users" />

      <div className={styles.content}>
        <div className={styles.header}>
          <h1 className={styles.title}>Users</h1>
          <div className={styles.controls}>
            <button className={styles.addButton} onClick={() => setIsAddOpen(true)}>
              <span>+</span> Add User
            </button>
          </div>
        </div>

        <AddUserModal
          isOpen={isAddOpen}
          branches={branches}
          roles={roles}
          onClose={() => setIsAddOpen(false)}
          onCreate={(payload) => {
            handleCreateUser(payload);
            setIsAddOpen(false);
          }}
        />

        <EditUserModal
          isOpen={!!editingUser}
          user={editingUser}
          branches={branches}
          roles={roles}
          saving={savingEdit}
          onClose={() => setEditingUser(null)}
          disableDeactivate={!!(editingUser && meId && editingUser.id === meId)}
          disableDeactivateReason={editingUser && meId && editingUser.id === meId ? "You can't deactivate your own account." : undefined}
          disableMakeInactiveBecauseLastAdmin={
            users.filter((u) => u.is_active !== false && (u.role === 'admin' || u.role === 'owner')).length <= 1 &&
            !!(
              editingUser &&
              (editingUser.role === 'admin' || editingUser.role === 'owner') &&
              editingUser.is_active !== false
            )
          }
          showDelete={meRole === 'admin' || meRole === 'owner'}
          deleting={deletingUser}
          disableDelete={
            !!(editingUser && meId && editingUser.id === meId) ||
            (users.filter((u) => u.is_active !== false && (u.role === 'admin' || u.role === 'owner')).length <= 1 &&
              !!(
                editingUser &&
                (editingUser.role === 'admin' || editingUser.role === 'owner') &&
                editingUser.is_active !== false
              ))
          }
          disableDeleteReason={
            editingUser && meId && editingUser.id === meId
              ? "You can't delete your own account."
              : users.filter((u) => u.is_active !== false && (u.role === 'admin' || u.role === 'owner')).length <= 1 &&
                  !!(
                    editingUser &&
                    (editingUser.role === 'admin' || editingUser.role === 'owner') &&
                    editingUser.is_active !== false
                  )
                ? 'At least one active admin/owner must remain.'
                : undefined
          }
          onDelete={(id) => void deleteUser(id)}
          onSave={(payload) => void saveUserEdits(payload)}
        />

        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>USERNAME</th>
                <th>NAME</th>
                <th>EMAIL</th>
                <th>PHONE</th>
                <th>PAN</th>
                <th>AADHAAR</th>
                <th>ROLE</th>
                <th>STATUS</th>
                <th>CREATED</th>
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map((u) => (
                <tr
                  key={u.id}
                  className={`${styles.clickableRow} ${u.is_active === false ? styles.inactiveRow : ''}`}
                  onClick={() => setEditingUser(u)}
                >
                  <td style={{ fontWeight: 700 }}>{u.username}</td>
                  <td>{`${u.first_name || ''} ${u.last_name || ''}`.trim() || '-'}</td>
                  <td style={{ fontWeight: 600 }}>{u.email}</td>
                  <td>{u.phone || '-'}</td>
                  <td>{u.pan || '-'}</td>
                  <td>{u.aadhar || '-'}</td>
                  <td>
                    <span className={styles.roleBadge}>{u.role}</span>
                  </td>
                  <td>
                    <span className={u.is_active === false ? styles.statusBadgeInactive : styles.statusBadgeActive}>
                      {u.is_active === false ? 'inactive' : 'active'}
                    </span>
                  </td>
                  <td>{new Date(u.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {loading ? (
            <div className={styles.emptyState}>Loading users…</div>
          ) : sortedUsers.length === 0 ? (
            <div className={styles.emptyState}>No users added yet. Click “Add User” to create one.</div>
          ) : null}
        </div>
      </div>
    </>
  );
}
