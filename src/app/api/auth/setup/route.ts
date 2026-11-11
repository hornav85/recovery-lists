import { NextResponse } from "next/server";
import { bootstrapAdmin } from "@/lib/auth";
import { countUsers, ensureFixtureLeads } from "@/lib/db";

export async function GET() {
  await ensureFixtureLeads();
  const users = await countUsers();
  const setupSecretConfigured = Boolean(process.env.SETUP_BOOTSTRAP_SECRET?.trim());
  return NextResponse.json({
    needsSetup: users === 0,
    setupSecretRequired: users === 0,
    setupSecretConfigured,
  });
}

export async function POST(req: Request) {
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
