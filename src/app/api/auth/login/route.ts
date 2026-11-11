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
  const keys = {
    userIp: `${username.toLowerCase()}|${ip}`,
    ip: `ip|${ip}`,
  };
  try {
    if (!(await checkLoginRateLimit(keys))) {
      return NextResponse.json(
        { error: "Too many login attempts. Try again later." },
        { status: 429 },
      );
    }
    await recordLoginAttempt(keys);
  } catch {
    // Fail closed in production / hosted — do not skip throttling.
    if (process.env.NODE_ENV === "production" || process.env.CURSOR_APP_ID) {
      return NextResponse.json(
        { error: "Login temporarily unavailable. Try again later." },
        { status: 503 },
      );
    }
  }

  const result = await login(username, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }
  return NextResponse.json({ user: result.user });
}
