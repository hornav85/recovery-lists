"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { PublicUser } from "@/lib/db";

export function AppShell({
  user,
  children,
}: {
  user: PublicUser;
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    if (user.mustChangePassword) {
      router.replace("/change-password");
    }
  }, [user.mustChangePassword, router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          Recovery <span>Lists</span>
        </Link>
        <nav className="nav">
          <Link href="/lists">Lists</Link>
          {user.role === "admin" && (
            <>
              <Link href="/admin/dashboard">Dashboard</Link>
              <Link href="/admin/reports">Reports</Link>
              <Link href="/admin/users">Users</Link>
              <Link href="/admin/statuses">Statuses</Link>
              <Link href="/admin/sync">Sync</Link>
            </>
          )}
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            {user.displayName} ({user.role})
          </span>
          <button type="button" className="linkish" onClick={logout}>
            Log out
          </button>
        </nav>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
