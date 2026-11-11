import { NextResponse } from "next/server";
import { checkLoginRateLimit, login, recordLoginAttempt } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";

export async function POST(req: Request) {
  await ensureFixtureLeads();
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || "");
  const password = String(body.password || "");
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const rateKey = `${username.toLowerCase()}|${ip}`;
  try {
    if (!(await checkLoginRateLimit(rateKey))) {
      return NextResponse.json(
        { error: "Too many login attempts. Try again later." },
        { status: 429 },
      );
    }
    await recordLoginAttempt(rateKey);
  } catch {
    // If rate-limit table isn't migrated yet, continue (login still works)
  }

  const result = await login(username, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }
  return NextResponse.json({ user: result.user });
}
