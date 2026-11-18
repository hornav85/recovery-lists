import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";
import { deleteManualList, listManualLists, uploadManualList } from "@/lib/manual-lists";

export async function GET() {
  try {
    await ensureFixtureLeads();
    await requireUser("admin");
    return NextResponse.json({ lists: await listManualLists() });
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
    const form = await req.formData();
    const name = String(form.get("name") || "");
    const replaceRaw = String(form.get("replaceId") || "");
    const replaceId = replaceRaw ? Number(replaceRaw) : null;
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose a CSV file to upload." }, { status: 400 });
    }
    if (file.size > 5_000_000) {
      return NextResponse.json({ error: "File is too large (5 MB max)." }, { status: 400 });
    }
    const csv = await file.text();
    const result = await uploadManualList({
      name,
      csv,
      replaceId: replaceId && Number.isFinite(replaceId) ? replaceId : null,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const skipped =
      result.skipped > 0
        ? ` Skipped ${result.skipped} row${result.skipped === 1 ? "" : "s"} without a name and phone, or with a duplicate phone.`
        : "";
    return NextResponse.json({
      ...result,
      message: `${result.replaced ? "Replaced" : "Created"} “${result.name}” with ${result.imported} prospect${result.imported === 1 ? "" : "s"}.${skipped}`,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}

export async function DELETE(req: Request) {
  try {
    await ensureFixtureLeads();
    await requireUser("admin");
    const body = await req.json().catch(() => ({}));
    const id = Number(body.id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const removed = await deleteManualList(id);
    if (!removed) return NextResponse.json({ error: "List not found" }, { status: 404 });
    return NextResponse.json({
      ok: true,
      message: "List removed. Past dials stay in Reports.",
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
