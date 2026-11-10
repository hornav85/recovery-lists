import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureFixtureLeads } from "@/lib/db";

export default async function HomePage() {
  ensureFixtureLeads();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  redirect("/lists");
}
