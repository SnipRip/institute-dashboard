"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import styles from "./Sidebar.module.css";
import { brandConfig } from "@/lib/config";
import { API_BASE_URL } from "@/lib/api";
import { getAuthToken } from "@/lib/auth";
import { DEFAULT_BUSINESS_MODULES, moduleLabels, normalizeBusinessModules, type BusinessModules } from "@/lib/businessModules";

type Me = { username?: string; role?: string };
type Company = { name?: string; logo_url?: string | null; business_modules?: Partial<BusinessModules> | null };

type NavItem = {
  href: string;
  label: string;
  icon: keyof typeof iconPaths;
  exact?: boolean;
  active?: (pathname: string, queryTab: string) => boolean;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const iconPaths = {
  home: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10",
  student: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  library: "M4 19.5A2.5 2.5 0 016.5 17H20M4 4.5A2.5 2.5 0 016.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15z",
  locker: "M7 7V6a2 2 0 012-2h6a2 2 0 012 2v1M7 7h10v13H7V7zM10 12h4",
  book: "M12 6.25v13M12 6.25C10.83 5.48 9.25 5 7.5 5S4.17 5.48 3 6.25v13C4.17 18.48 5.75 18 7.5 18s3.33.48 4.5 1.25M12 6.25C13.17 5.48 14.75 5 16.5 5s3.33.48 4.5 1.25v13C19.83 18.48 18.25 18 16.5 18s-3.33.48-4.5 1.25",
  class: "M20 7l-8-4-8 4 8 4 8-4zM4 7v10l8 4 8-4V7M12 11v10",
  bill: "M9 14h6M9 10h6M7 3h10a2 2 0 012 2v16l-4-2-3 2-3-2-4 2V5a2 2 0 012-2z",
  money: "M3 6h18v12H3V6zM7 10h.01M17 14h.01M12 9a3 3 0 110 6 3 3 0 010-6z",
  cart: "M6 6h15l-2 8H8L6 3H3M8 21a1 1 0 100-2 1 1 0 000 2M18 21a1 1 0 100-2 1 1 0 000 2",
  report: "M9 17v-6M13 17V7M17 17v-3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06A1.65 1.65 0 0015 19.4a1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09A1.65 1.65 0 0015 4.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.36.15.75.15 1.11.15H21a2 2 0 010 4h-.09A1.65 1.65 0 0019.4 15z",
  users: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
};

function Icon({ name }: { name: keyof typeof iconPaths }) {
  return (
    <svg className={styles.icon} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPaths[name]} />
    </svg>
  );
}

function resolvePublicUrl(url: string): string {
  const u = url.trim();
  if (!u) return u;
  if (/^(https?:\/\/|data:|blob:)/i.test(u)) return u;
  if (u.startsWith("/")) return `${API_BASE_URL}${u}`;
  return `${API_BASE_URL}/${u}`;
}

function buildNavGroups(modules: BusinessModules): NavGroup[] {
  const hasAcademics = modules.coaching || modules.school;

  const groups: NavGroup[] = [
    {
      title: "Home",
      items: [{ href: "/", label: "Dashboard", icon: "home", exact: true }],
    },
    {
      title: "Admissions",
      items: [{ href: "/students", label: "Students", icon: "student" }],
    },
    {
      title: "Library",
      items: [
        modules.selfStudyLibrary ? { href: "/library", label: "Seats & Shifts", icon: "library", exact: true } : null,
        modules.lockers ? { href: "/library/lockers", label: "Lockers", icon: "locker" } : null,
        modules.books ? { href: "/library/books", label: "Books", icon: "book" } : null,
      ].filter(Boolean) as NavItem[],
    },
    {
      title: modules.school && !modules.coaching ? "School" : "Academics",
      items: hasAcademics ? [{ href: "/classes", label: modules.school && !modules.coaching ? "Classes" : "Batches & Courses", icon: "class" }] : [],
    },
    {
      title: "Finance",
      items: [
        modules.billing ? { href: "/billing", label: "Billing", icon: "bill" } : null,
        modules.accounting ? { href: "/accounting?tab=expenses", label: "Expenses", icon: "money", active: (p: string, tab: string) => p.startsWith("/accounting") && tab !== "purchases" } : null,
        modules.purchases ? { href: "/accounting?tab=purchases", label: "Purchases & Assets", icon: "cart", active: (p: string, tab: string) => p.startsWith("/accounting") && tab === "purchases" } : null,
      ].filter(Boolean) as NavItem[],
    },
    {
      title: "Reports",
      items: modules.reports
        ? [
            { href: "/reports/balance-sheet", label: "Balance Sheet", icon: "report" },
            { href: "/reports/profit-loss", label: "Profit & Loss", icon: "report" },
            { href: "/reports/cash-bank-book", label: "Cash/Bank Book", icon: "report" },
            { href: "/reports/trial-balance", label: "Trial Balance", icon: "report" },
            { href: "/reports/ledger", label: "Student Ledger", icon: "report" },
            { href: "/reports/company-ledger", label: "Company Ledger", icon: "report" },
          ]
        : [],
    },
    {
      title: "Administration",
      items: [
        { href: "/settings/company", label: "Company Settings", icon: "settings" },
        { href: "/settings/branches", label: "Branches", icon: "settings" },
        { href: "/settings/roles", label: "Roles & Permissions", icon: "users" },
        modules.users ? { href: "/users", label: "Users", icon: "users" } : null,
      ].filter(Boolean) as NavItem[],
    },
  ];

  return groups.filter((group) => group.items.length > 0);
}

export default function Sidebar() {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const accountingTab = (searchParams?.get("tab") || "").toLowerCase();

  const [me, setMe] = useState<Me | null>(null);
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [modules, setModules] = useState<BusinessModules>(DEFAULT_BUSINESS_MODULES);

  useEffect(() => {
    let cancelled = false;

    async function loadHeaderData() {
      const token = getAuthToken();
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}` };

      const [meRes, companyRes] = await Promise.allSettled([
        fetch(`${API_BASE_URL}/me`, { headers }),
        fetch(`${API_BASE_URL}/company`, { headers }),
      ]);

      if (!cancelled && meRes.status === "fulfilled" && meRes.value.ok) {
        const body = (await meRes.value.json().catch(() => null)) as Me | null;
        if (body) setMe(body);
      }

      if (!cancelled && companyRes.status === "fulfilled" && companyRes.value.ok) {
        const body = (await companyRes.value.json().catch(() => null)) as Company | null;
        const url = typeof body?.logo_url === "string" ? body.logo_url : "";
        setCompanyLogoUrl(url ? resolvePublicUrl(url) : null);
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        if (name) setCompanyName(name);
        setModules(normalizeBusinessModules(body?.business_modules));
      }
    }

    void loadHeaderData();
    return () => {
      cancelled = true;
    };
  }, []);

  const secondaryLine = useMemo(() => {
    const username = (me?.username || "").trim();
    const role = (me?.role || "").trim();
    if (!username) return moduleLabels(modules).join(" + ");
    return role ? `${username} (${role})` : username;
  }, [me, modules]);

  const primaryLine = useMemo(() => (companyName || "").trim() || brandConfig.name, [companyName]);
  const navGroups = useMemo(() => buildNavGroups(modules), [modules]);

  const isActive = (item: NavItem) => {
    if (item.active) return item.active(pathname, accountingTab);
    if (item.exact) return pathname === item.href.split("?")[0];
    return pathname.startsWith(item.href.split("?")[0]);
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.headerGroup}>
        <Link href="/" className={styles.brand}>
          <div className={`${styles.brandAvatar} ${companyLogoUrl ? styles.brandAvatarImage : styles.brandAvatarFallback}`}>
            {companyLogoUrl ? (
              <img className={styles.brandAvatarImg} src={companyLogoUrl} alt="Company logo" onError={() => setCompanyLogoUrl(null)} />
            ) : (
              brandConfig.logo
            )}
          </div>
          <div className={styles.brandInfo}>
            <h1>{primaryLine}</h1>
            <span>{secondaryLine}</span>
          </div>
        </Link>

        {modules.billing ? (
          <Link className={styles.createButton} href="/billing/create">
            <span>+</span> New Invoice
          </Link>
        ) : null}
      </div>

      {navGroups.map((group) => (
        <div key={group.title} className={styles.menuGroup}>
          <div className={styles.menuHeader}>{group.title}</div>
          <ul className={styles.menuList}>
            {group.items.map((item) => (
              <li key={item.href} className={styles.menuItem}>
                <Link href={item.href} className={`${styles.menuLink} ${isActive(item) ? styles.menuLinkActive : ""}`}>
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className={styles.spacer} />
      <div className={styles.footer}>Configured for {moduleLabels(modules).join(" + ")}</div>
    </aside>
  );
}
