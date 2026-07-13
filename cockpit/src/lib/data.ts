import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { EMPTY } from "@/lib/utils";
import type { PersonnelRow, Patient } from "@/lib/types";

/** Fiche Personnel du propriétaire (Dr Amraoui) — défaut des responsables/médecins. */
export const getOwnerPersonnelId = cache(async (): Promise<string | null> => {
  const { data } = await supabaseAdmin()
    .from("app_members")
    .select("personnel_notion_id")
    .eq("is_owner", true)
    .not("personnel_notion_id", "is", null)
    .limit(1)
    .maybeSingle();
  return data?.personnel_notion_id ?? null;
});

/**
 * Petites tables de référence, chargées une fois par requête.
 * La RLS s'applique (client lié à la session).
 */

export const getPersonnel = cache(async (): Promise<PersonnelRow[]> => {
  const supa = await supabaseServer();
  const { data } = await supa.from("personnel").select("notion_id, nom, role, specialite, email, actif").order("nom");
  return (data ?? []) as PersonnelRow[];
});

export const getPersonnelMap = cache(async (): Promise<Map<string, string>> => {
  const rows = await getPersonnel();
  return new Map(rows.map((r) => [r.notion_id, r.nom ?? "?"]));
});

export const getPatientsIndex = cache(async (): Promise<Map<string, Patient>> => {
  const supa = await supabaseServer();
  const { data } = await supa
    .from("patients")
    .select(
      "notion_id, nom, nom_complet, psid, statut, type_patient, probleme_principal, niveau_vigilance, telephone, phone, phone_1, email, email_1, lien_doctolib, lien_dossier_securise, dernier_rdv, prochain_rdv, rappel_rdv_envoye_le, medecin_assigne, created_time, date_naissance, adresse, notes_secretariat"
    );
  return new Map(((data ?? []) as Patient[]).map((p) => [p.notion_id, p]));
});

/** Secrétaires actives (module Horaires), triées par nom. */
export const getSecretaires = cache(async (): Promise<PersonnelRow[]> => {
  const rows = await getPersonnel();
  return rows.filter((p) => p.actif && p.role === "Secrétaire");
});

/**
 * Réglages du cabinet (table parametres) sous forme de Map nom→valeur.
 * Chargé une fois par requête ; les défauts sont gérés côté appelant.
 */
export const getSettingsMap = cache(async (): Promise<Map<string, string>> => {
  const supa = await supabaseServer();
  const { data } = await supa.from("parametres").select("parametre, valeur");
  const m = new Map<string, string>();
  for (const r of (data ?? []) as { parametre: string | null; valeur: string | null }[]) {
    if (r.parametre) m.set(r.parametre, (r.valeur ?? "").trim());
  }
  return m;
});

/**
 * Décision (8 juil.) : l'IPA est traitée comme un médecin partout —
 * sélecteurs d'assignation, prise en charge des cas, vues médecin.
 */
export function isSoignant(p: PersonnelRow): boolean {
  return p.actif && (p.role === "Médecin" || p.role === "IPA");
}

/** Nom du patient pour une liste d'ids (relation Notion). */
export function patientName(ids: string[] | null | undefined, index: Map<string, Patient>): string {
  if (!ids || ids.length === 0) return EMPTY;
  return ids.map((id) => index.get(id)?.nom ?? "?").join(", ");
}

export function personName(ids: string[] | null | undefined, map: Map<string, string>): string {
  if (!ids || ids.length === 0) return EMPTY;
  return ids.map((id) => map.get(id) ?? "?").join(", ");
}
