import { NextResponse } from "next/server";
import { bootstrapAdmin, isHostedDeployment } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";

/**
 * Hosted / production: HTTP first-admin setup is disabled entirely.
 * Create the admin while the app is private (or locally), then go public.
 */
export async function GET() {
  if (isHostedDeployment()) {
    return NextResponse.json({ needsSetup: false, setupDisabled: true });
  }
  await ensureFixtureLeads();
  const { countUsers } = await import("@/lib/db");
  const users = await countUsers();
  const setupSecretConfigured = Boolean(process.env.SETUP_BOOTSTRAP_SECRET?.trim());
  return NextResponse.json({
    needsSetup: users === 0,
    setupSecretRequired: users === 0,
    setupSecretConfigured,
    setupDisabled: false,
  });
}

export async function POST(req: Request) {
  if (isHostedDeployment()) {
    return NextResponse.json(
      { error: "HTTP setup is disabled on the published app" },
      { status: 404 },
    );
  }
  await ensureFixtureLeads();
  const body = await req.json().catch(() => ({}));
  const headerSecret = req.headers.get("x-setup-bootstrap-secret") || "";
  const bodySecret = String(body.bootstrapSecret || body.setupSecret || "");
  const result = await bootstrapAdmin({
    username: String(body.username || ""),
    email: String(body.email || ""),
    password: String(body.password || ""),
    displayName: String(body.displayName || body.username || ""),
    bootstrapSecret: headerSecret || bodySecret,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ user: result.user });
}
