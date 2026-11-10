import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";
import { getSyncConfig, getSyncMeta, runSync } from "@/lib/sync";

export async function GET() {
  try {
    await ensureFixtureLeads();
    await requireUser("admin");
    const meta = await getSyncMeta();
    const config = getSyncConfig();
    return NextResponse.json({
      ...meta,
      ...config,
      sheetsMode: "read-only",
      preferredMode: config.hasAppsScript
        ? "apps-script"
        : config.hasServiceAccount
          ? "google"
          : "fixture-or-csv",
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}

export async function POST(req: Request) {
  try {
    await ensureFixtureLeads();
    await requireUser("admin");
    const body = await req.json().catch(() => ({}));
    const result = await runSync({
      csvDatabase: body.csvDatabase ? String(body.csvDatabase) : undefined,
      csvDnc: body.csvDnc ? String(body.csvDnc) : undefined,
      forceFixture: Boolean(body.forceFixture),
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
