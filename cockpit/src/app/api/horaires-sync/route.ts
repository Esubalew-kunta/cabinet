import { NextRequest, NextResponse } from "next/server";
import { drainHorairesToNotion } from "@/lib/horaires-sync";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Pousse les semaines d'horaires « dirty » vers le miroir Notion (throttlé).
 * Autorisé : cron n8n (Bearer CRON_SECRET) ou membre avec la permission planning.
 */
async function isAuthorized(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;

  const supa = await supabaseServer();
  const { data: userData } = await supa.auth.getUser();
  if (!userData.user) return false;
  const admin = supabaseAdmin();
  const { data: member } = await admin
    .from("app_members")
    .select("role,is_owner,active")
    .eq("auth_user_id", userData.user.id)
    .single();
  if (!member || !member.active) return false;
  if (member.is_owner || member.role === "admin") return true;
  const { data: perm } = await admin
    .from("app_permissions")
    .select("level")
    .eq("role", member.role)
    .eq("area", "planning")
    .single();
  return perm?.level !== "none" && !!perm?.level;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const result = await drainHorairesToNotion();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
