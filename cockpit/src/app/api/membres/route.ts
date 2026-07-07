import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePerm, generatePassword } from "@/lib/api-guard";

/**
 * POST — créer un membre :
 * 1. crée le compte Supabase (mot de passe généré, affiché une seule fois)
 * 2. lie la fiche Personnel Notion par email si elle existe
 * 3. insère la ligne app_members
 */
export async function POST(req: NextRequest) {
  const guard = await requirePerm("gestion_comptes");
  if ("error" in guard) return guard.error;

  const body = await req.json();
  const email = String(body.email ?? "").trim().toLowerCase();
  const nom = String(body.nom ?? "").trim() || null;
  const role = String(body.role ?? "");
  const isOwner = Boolean(body.is_owner);

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Email invalide" }, { status: 400 });
  }
  if (!["admin", "medecin", "secretaire", "ipa", "externe"].includes(role)) {
    return NextResponse.json({ error: "Rôle invalide" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  const { data: existing } = await admin.from("app_members").select("id").eq("email", email).maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "Un membre existe déjà avec cet email" }, { status: 409 });
  }

  const password = generatePassword();
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authErr || !created.user) {
    return NextResponse.json({ error: authErr?.message ?? "Création du compte impossible" }, { status: 500 });
  }

  // Lier la fiche Personnel (Notion) par email — le "Notion name" du brief
  const { data: person } = await admin
    .from("personnel")
    .select("notion_id, nom")
    .ilike("email", email)
    .maybeSingle();

  const { data: member, error: insErr } = await admin
    .from("app_members")
    .insert({
      auth_user_id: created.user.id,
      email,
      nom: nom ?? person?.nom ?? null,
      personnel_notion_id: body.personnel_notion_id ?? person?.notion_id ?? null,
      role,
      is_owner: isOwner,
      active: true,
    })
    .select("*")
    .single();

  if (insErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ member, password });
}

/** PATCH — modifier un membre (rôle, actif, fiche Notion, owner, nouveau mot de passe) */
export async function PATCH(req: NextRequest) {
  const guard = await requirePerm("gestion_comptes");
  if ("error" in guard) return guard.error;

  const body = await req.json();
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: target } = await admin.from("app_members").select("*").eq("id", id).single();
  if (!target) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (body.role !== undefined) patch.role = body.role;
  if (body.active !== undefined) patch.active = Boolean(body.active);
  if (body.nom !== undefined) patch.nom = body.nom || null;
  if (body.personnel_notion_id !== undefined) patch.personnel_notion_id = body.personnel_notion_id || null;
  if (body.is_owner !== undefined) patch.is_owner = Boolean(body.is_owner);

  let newPassword: string | undefined;
  if (body.reset_password && target.auth_user_id) {
    newPassword = generatePassword();
    const { error } = await admin.auth.admin.updateUserById(target.auth_user_id, { password: newPassword });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from("app_members").update(patch).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, password: newPassword });
}
