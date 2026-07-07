import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/notion/sync";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 300; // le pull complet peut prendre du temps

async function isAuthorized(req: NextRequest): Promise<"cron" | "manual" | null> {
  // 1) Vercel Cron (ou appel externe) avec le secret
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${process.env.CRON_SECRET}` && process.env.CRON_SECRET) return "cron";

  // 2) Membre connecté avec la permission "sync"
  const supa = await supabaseServer();
  const { data: userData } = await supa.auth.getUser();
  if (!userData.user) return null;
  const admin = supabaseAdmin();
  const { data: member } = await admin
    .from("app_members")
    .select("role,is_owner,active")
    .eq("auth_user_id", userData.user.id)
    .single();
  if (!member || !member.active) return null;
  if (member.is_owner || member.role === "admin") return "manual";
  const { data: perm } = await admin
    .from("app_permissions")
    .select("level")
    .eq("role", member.role)
    .eq("area", "sync")
    .single();
  return perm?.level === "full" ? "manual" : null;
}

export async function POST(req: NextRequest) {
  const source = await isAuthorized(req);
  if (!source) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const result = await runSync(source);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

// Vercel Cron utilise GET
export async function GET(req: NextRequest) {
  return POST(req);
}
