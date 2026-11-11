"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [setupSecretConfigured, setSetupSecretConfigured] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/setup")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setNeedsSetup(Boolean(data.needsSetup));
          setSetupSecretConfigured(Boolean(data.setupSecretConfigured));
        }
      })
      .catch(() => {
        if (!cancelled) setNeedsSetup(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }
      if (data.user?.mustChangePassword) {
        router.push("/change-password");
      } else {
        router.push("/lists");
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function onSetup(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-setup-bootstrap-secret": bootstrapSecret,
        },
        body: JSON.stringify({
          username,
          email,
          password,
          displayName,
          bootstrapSecret,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Setup failed");
        return;
      }
      router.push("/lists");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (needsSetup === null) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <p className="muted">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>
          Recovery <span style={{ color: "var(--accent)" }}>Lists</span>
        </h1>
        <p className="muted" style={{ marginTop: 0 }}>
          {needsSetup
            ? setupSecretConfigured
              ? "Create the first admin. You need the setup bootstrap secret from app Secrets."
              : "Setup is locked until SETUP_BOOTSTRAP_SECRET is set in Cursor App Secrets."
            : "Sign in with your admin or agent account."}
        </p>
        <form className="stack" onSubmit={needsSetup ? onSetup : onLogin}>
          {needsSetup && (
            <label className="field">
              Setup secret
              <input
                type="password"
                autoComplete="off"
                value={bootstrapSecret}
                onChange={(e) => setBootstrapSecret(e.target.value)}
                required
                disabled={!setupSecretConfigured}
              />
            </label>
          )}
          <label className="field">
            Username
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={needsSetup && !setupSecretConfigured}
            />
          </label>
          {needsSetup && (
            <>
              <label className="field">
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={!setupSecretConfigured}
                />
              </label>
              <label className="field">
                Display name
                <input
                  type="text"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={!setupSecretConfigured}
                />
              </label>
            </>
          )}
          <label className="field">
            Password
            <input
              type="password"
              autoComplete={needsSetup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={needsSetup ? 10 : undefined}
              disabled={needsSetup && !setupSecretConfigured}
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button
            className="btn"
            type="submit"
            disabled={loading || (needsSetup && !setupSecretConfigured)}
          >
            {loading
              ? needsSetup
                ? "Creating…"
                : "Signing in…"
              : needsSetup
                ? "Create admin"
                : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
