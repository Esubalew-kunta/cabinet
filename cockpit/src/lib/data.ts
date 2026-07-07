import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { EMPTY } from "@/lib/utils";
import type { PersonnelRow, Patient } from "@/lib/types";

/**
 * Petites tables de référence, chargées une fois par requête.
 * La RLS s'applique (client lié à la session).
 */

export const getPersonnel = cache(async (): Promise<PersonnelRow[]> => {
  const supa = await supabaseServer();
  const { data } = await supa.from("personnel").select("notion_id, nom, role, email, actif").order("nom");
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
      "notion_id, nom, nom_complet, psid, statut, type_patient, probleme_principal, niveau_vigilance, telephone, phone, phone_1, email, email_1, lien_doctolib, lien_dossier_securise, dernier_rdv, prochain_rdv, rappel_rdv_envoye_le, medecin_assigne, created_time"
    );
  return new Map(((data ?? []) as Patient[]).map((p) => [p.notion_id, p]));
});

/** Nom du patient pour une liste d'ids (relation Notion). */
export function patientName(ids: string[] | null | undefined, index: Map<string, Patient>): string {
  if (!ids || ids.length === 0) return EMPTY;
  return ids.map((id) => index.get(id)?.nom ?? "?").join(", ");
}

export function personName(ids: string[] | null | undefined, map: Map<string, string>): string {
  if (!ids || ids.length === 0) return EMPTY;
  return ids.map((id) => map.get(id) ?? "?").join(", ");
}
