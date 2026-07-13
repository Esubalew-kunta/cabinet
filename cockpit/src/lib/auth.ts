import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AppMember, Permissions, PermLevel } from "@/lib/types";

export type Session = {
  member: AppMember;
  perms: Permissions;
};

/**
 * Contexte du membre connecté (mémoïsé par requête).
 * - non connecté → redirect /connexion
 * - compte inconnu ou désactivé → déconnexion + /connexion?erreur=inactif
 * - owner/admin → 'full' partout
 */
export const getSession = cache(async (): Promise<Session> => {
  const supa = await supabaseServer();
  const { data: userData } = await supa.auth.getUser();
  if (!userData.user) redirect("/connexion");

  const admin = supabaseAdmin();
  const { data: member } = await admin
    .from("app_members")
    .select("*")
    .eq("auth_user_id", userData.user.id)
    .single();

  if (!member || !member.active) {
    redirect("/connexion?erreur=inactif");
  }

  const { data: permRows } = await admin
    .from("app_permissions")
    .select("area, level")
    .eq("role", member.role);

  const perms: Permissions = {};
  for (const r of permRows ?? []) perms[r.area] = r.level as PermLevel;

  if (member.is_owner || member.role === "admin") {
    for (const k of Object.keys(perms)) perms[k] = "full";
    // zones qui n'auraient pas de ligne
    for (const area of [
      "patients_all","patients_own","dossiers_all","dossiers_own","taches","taches_perso_dr",
      "examens","stock","planning","abonnes","perfusions","paiements_own","paiements_all","finances","admin_stats","gestion_comptes","sync",
    ]) perms[area] = "full";
  }

  return { member: member as AppMember, perms };
});

export function can(session: Session, area: string): boolean {
  return (session.perms[area] ?? "none") !== "none";
}

/** Page d'accueil selon le rôle. */
export function homeFor(member: AppMember): string {
  if (member.is_owner || member.role === "admin") return "/admin";
  if (member.role === "medecin") return "/medecin";
  if (member.role === "secretaire") return "/secretariat";
  if (member.role === "ipa") return "/perfusions";
  return "/taches";
}
