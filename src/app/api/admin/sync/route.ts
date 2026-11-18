import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";
import { getSyncConfig, getSyncMeta, MAX_CSV_CHARS, runSync } from "@/lib/sync";

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
      maxCsvChars: MAX_CSV_CHARS,
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

    const contentLength = Number(req.headers.get("content-length") || 0);
    // ~2MB CSV + JSON wrapper headroom
    if (contentLength > MAX_CSV_CHARS * 2 + 64_000) {
      return NextResponse.json(
        { error: `Request body too large (max ~${MAX_CSV_CHARS} CSV chars)` },
        { status: 413 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const csvDatabase = body.csvDatabase ? String(body.csvDatabase) : undefined;
    const csvDnc = body.csvDnc ? String(body.csvDnc) : undefined;
    if (
      (csvDatabase && csvDatabase.length > MAX_CSV_CHARS) ||
      (csvDnc && csvDnc.length > MAX_CSV_CHARS)
    ) {
      return NextResponse.json(
        { error: `CSV too large (max ${MAX_CSV_CHARS} characters per file)` },
        { status: 413 },
      );
    }

    const result = await runSync({
      csvDatabase,
      csvDnc,
      forceFixture: Boolean(body.forceFixture),
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : "Sync failed";
    if (/too large/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 413 });
    }
    throw e;
  }
}
