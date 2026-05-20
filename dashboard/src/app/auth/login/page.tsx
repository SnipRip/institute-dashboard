"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./login.module.css";
import { DottedGlowBackground } from "@/components/ui/dotted-glow-background";
import { API_BASE_URL } from "@/lib/api";
import { setAuthToken } from "@/lib/auth";
import { brandConfig } from "@/lib/config";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState<Array<{ id: string; name: string; role: string; isDefault?: boolean }>>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brandName, setBrandName] = useState<string>(brandConfig.name);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/company/public`);
        if (!res.ok) return;
        const body = (await res.json().catch(() => null)) as { name?: string } | null;
        const name = (body?.name || "").trim();
        if (!cancelled && name) setBrandName(name);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, branchId: branchId || undefined }),
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Login failed");
      if (body.requiresBranchSelection && Array.isArray(body.branches)) {
        setBranches(body.branches);
        const defaultBranch = body.branches.find((b: { isDefault?: boolean }) => b.isDefault) || body.branches[0];
        setBranchId(defaultBranch?.id || "");
        return;
      }
      setAuthToken(body.token);
      router.push("/");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <DottedGlowBackground
        className={styles.bg}
        opacity={1}
        gap={10}
        radius={1.6}
        colorLightVar="--color-neutral-500"
        glowColorLightVar="--color-neutral-600"
        colorDarkVar="--color-neutral-500"
        glowColorDarkVar="--color-sky-800"
        backgroundOpacity={0}
        speedMin={0.3}
        speedMax={1.6}
        speedScale={1}
      />

      <main className={styles.container}>
        <div className={styles.brandOutside}>{brandName}</div>

        <div className={styles.card}>
          <h1 className={styles.title}>Welcome back</h1>
          <p className={styles.subtitle}>Sign in to continue to your dashboard</p>

          <form onSubmit={submit} className={styles.form}>
            <label className={styles.label}>
              Email or username
              <input
                placeholder="you@school.edu or username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={styles.input}
                type="text"
                required
              />
            </label>

            <label className={styles.label}>
              Password
              <div className={styles.passwordWrap}>
                <input
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${styles.input} ${styles.inputWithToggle}`}
                  type={showPassword ? "text" : "password"}
                  required
                />
                <button
                  type="button"
                  className={styles.toggleBtn}
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            {branches.length > 1 ? (
              <label className={styles.label}>
                Branch
                <select
                  className={styles.input}
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  required
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name} ({branch.role})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {error && <div className={styles.error}>{error}</div>}

            <button type="submit" className={styles.button} disabled={loading}>
              {loading ? "Signing in..." : branches.length > 1 ? "Continue to branch" : "Sign in"}
            </button>

            <div className={styles.rowBetween}>
              <span className={styles.smallLink} />
              <span className={styles.smallLink} />
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

