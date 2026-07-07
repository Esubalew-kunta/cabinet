import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePerm } from "@/lib/api-guard";
import { AREA_KEYS } from "@/lib/labels";

/** PATCH : modifier une cellule de la matrice d'accès */
export async function PATCH(req: NextRequest) {
  const guard = await requirePerm("gestion_comptes");
  if ("error" in guard) return guard.error;

  const body = await req.json();
  const role = String(body.role ?? "");
  const area = String(body.area ?? "");
  const level = String(body.level ?? "");

  if (!["medecin", "secretaire", "ipa", "externe", "admin"].includes(role)) {
    return NextResponse.json({ error: "Rôle invalide" }, { status: 400 });
  }
  if (!AREA_KEYS.some((k) => k === area)) {
    return NextResponse.json({ error: "Zone invalide" }, { status: 400 });
  }
  if (!["none", "status", "full"].includes(level)) {
    return NextResponse.json({ error: "Niveau invalide" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("app_permissions")
    .upsert({ role, area, level }, { onConflict: "role,area" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
