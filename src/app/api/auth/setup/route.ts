import { NextResponse } from "next/server";
import { bootstrapAdmin } from "@/lib/auth";
import { countUsers, ensureFixtureLeads } from "@/lib/db";

export async function GET() {
  await ensureFixtureLeads();
  const users = await countUsers();
  return NextResponse.json({ needsSetup: users === 0 });
}

export async function POST(req: Request) {
  await ensureFixtureLeads();
  const body = await req.json().catch(() => ({}));
  const result = await bootstrapAdmin({
    username: String(body.username || ""),
    email: String(body.email || ""),
    password: String(body.password || ""),
    displayName: String(body.displayName || body.username || ""),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ user: result.user });
}
