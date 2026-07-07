import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AppMember } from "@/lib/types";

/**
 * Garde d'API : vérifie que l'appelant est connecté, actif, et possède
 * la permission demandée. Retourne le membre ou une réponse 401/403.
 */
export async function requirePerm(
  area: string | null
): Promise<{ member: AppMember } | { error: NextResponse }> {
  const supa = await supabaseServer();
  const { data: userData } = await supa.auth.getUser();
  if (!userData.user) {
    return { error: NextResponse.json({ error: "Non connecté" }, { status: 401 }) };
  }
  const admin = supabaseAdmin();
  const { data: member } = await admin
    .from("app_members")
    .select("*")
    .eq("auth_user_id", userData.user.id)
    .single();
  if (!member || !member.active) {
    return { error: NextResponse.json({ error: "Compte inactif" }, { status: 403 }) };
  }
  if (area && !member.is_owner && member.role !== "admin") {
    const { data: perm } = await admin
      .from("app_permissions")
      .select("level")
      .eq("role", member.role)
      .eq("area", area)
      .single();
    if (!perm || perm.level === "none") {
      return { error: NextResponse.json({ error: "Accès refusé" }, { status: 403 }) };
    }
  }
  return { member: member as AppMember };
}

/** Mot de passe lisible et solide : 3 blocs de 4 + 2 chiffres, ex. "kzted-mafyr-vohwa-38" */
export function generatePassword(): string {
  const consonants = "bcdfghjklmnprstvwz";
  const vowels = "aeiou";
  const block = () => {
    let s = "";
    for (let i = 0; i < 2; i++) {
      s += consonants[Math.floor(Math.random() * consonants.length)];
      s += vowels[Math.floor(Math.random() * vowels.length)];
    }
    return s;
  };
  const digits = Math.floor(10 + Math.random() * 90);
  return `${block()}-${block()}-${block()}-${digits}`;
}
