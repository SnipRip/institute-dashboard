import crypto from "node:crypto";
import { getPool } from "../db/pool.js";

export type SessionUser = {
  id: string;
  username: string;
  role: string;
  roleId: string | null;
  branchId: string | null;
  branchName: string | null;
  permissions: string[];
};

export function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

export async function getUserBySessionToken(token: string): Promise<SessionUser | null> {
  const pool = getPool();
  const result = await pool.query(
    `select
       u.id,
       u.username,
       coalesce(r.name, u.role) as role,
       r.id as role_id,
       s.branch_id,
       b.name as branch_name,
       coalesce(
         array_agg(rp.permission_code order by rp.permission_code)
           filter (where rp.permission_code is not null),
         '{}'::text[]
       ) as permissions
     from sessions s
     join users u on u.id = s.user_id
     left join branches b on b.id = s.branch_id
     left join user_branch_access uba
       on uba.user_id = u.id
      and uba.branch_id = s.branch_id
      and uba.is_active = true
     left join roles r on r.id = uba.role_id
     left join role_permissions rp on rp.role_id = r.id
     where s.token = $1
       and s.expires_at > now()
       and u.is_active = true
       and u.deleted_at is null
       and (
         s.branch_id is null
         or (
           b.is_active = true
           and uba.user_id is not null
         )
       )
     group by u.id, u.username, u.role, r.name, r.id, s.branch_id, b.name
     limit 1`,
    [token],
  );

  const row = result.rows[0] as
    | {
        id: string;
        username: string;
        role: string;
        role_id: string | null;
        branch_id: string | null;
        branch_name: string | null;
        permissions: string[];
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    roleId: row.role_id,
    branchId: row.branch_id,
    branchName: row.branch_name,
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
  };
}

export async function createSession(userId: string, token: string, expiresAt: Date, branchId?: string | null) {
  const pool = getPool();
  await pool.query(
    `insert into sessions (user_id, token, expires_at, branch_id)
     values ($1, $2, $3, $4::uuid)`,
    [userId, token, expiresAt.toISOString(), branchId ?? null],
  );
}
