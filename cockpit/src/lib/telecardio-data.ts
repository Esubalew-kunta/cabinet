import { supabaseServer } from "@/lib/supabase/server";
import type { TelecardioPatient, TelecardioStatut } from "@/lib/types";
import { buildMonths, cellKey, currentMonthISO } from "@/lib/telecardio";

/**
 * Lecture en base de la grille Télécardiologie (côté serveur uniquement).
 * Séparé de telecardio.ts pour garder ce dernier pur et testable (cf. son en-tête).
 */

export type TelecardioData = {
  patients: TelecardioPatient[];
  months: string[];
  /** clé `${patientId}|${mois}` → tri-état. */
  statutMap: Map<string, boolean | null>;
};

/** Charge la grille complète : patients actifs, mois à afficher, et les cases. */
export async function getTelecardioData(): Promise<TelecardioData> {
  const supa = await supabaseServer();
  const [patientsRes, statutsRes] = await Promise.all([
    supa
      .from("telecardio_patients")
      .select("*")
      .eq("actif", true)
      .order("ordre", { ascending: true })
      .order("nom", { ascending: true }),
    supa.from("telecardio_statuts").select("*"),
  ]);

  const patients = (patientsRes.data ?? []) as TelecardioPatient[];
  const statuts = (statutsRes.data ?? []) as TelecardioStatut[];

  const statutMap = new Map<string, boolean | null>();
  const present = new Set<string>();
  for (const s of statuts) {
    const mois = String(s.mois).slice(0, 10);
    present.add(mois);
    statutMap.set(cellKey(s.patient_id, mois), s.facture);
  }

  const months = buildMonths(present, currentMonthISO());
  return { patients, months, statutMap };
}
