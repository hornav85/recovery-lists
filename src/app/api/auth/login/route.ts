import { NextResponse } from "next/server";
import { login } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";

export async function POST(req: Request) {
  ensureFixtureLeads();
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || "");
  const password = String(body.password || "");
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }
  const result = await login(username, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }
  return NextResponse.json({ user: result.user });
}
