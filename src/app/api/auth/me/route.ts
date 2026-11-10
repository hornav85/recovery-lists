import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  await ensureFixtureLeads();
  return NextResponse.json({ user });
}
