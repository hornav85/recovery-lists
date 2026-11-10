import { NextResponse } from "next/server";
import { AuthError, changePassword, requireUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";

export async function POST(req: Request) {
  try {
    await ensureFixtureLeads();
    const user = await requireUser(undefined, { allowMustChange: true });
    const body = await req.json().catch(() => ({}));
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "currentPassword and newPassword required" },
        { status: 400 },
      );
    }
    const result = await changePassword(user.id, currentPassword, newPassword);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
