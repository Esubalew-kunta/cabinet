import type { TelecardioPatient } from "@/lib/types";
import type { Lang } from "@/lib/i18n/dict";

/**
 * Télécardiologie — logique PURE du suivi de facturation mensuel.
 *
 * Les mois sont des données, pas des colonnes SQL (cf. migration 015) : la grille
 * calcule ici la liste des colonnes à afficher, et une case se lit dans une Map.
 *
 * Aucun import runtime `@/…` ici (Supabase, etc.) : ce fichier est couvert par des
 * tests Vitest, qui n'ont pas d'alias `@`. La lecture en base vit dans
 * telecardio-data.ts.
 */

/** Le 1er du mois courant, au format 'YYYY-MM-01' (UTC, stable). */
export function currentMonthISO(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/**
 * Les colonnes de mois à afficher : tous les mois présents dans les statuts,
 * PLUS le mois courant (sa colonne existe donc toujours, même vide), triés.
 *
 * On n'invente pas les mois manquants entre deux dates : la source a des trous
 * (nov. 2023 puis mai 2024), et remplir le vide créerait des colonnes fantômes.
 * Un nouveau mois apparaît de lui-même quand un statut y est saisi, ou via le
 * mois courant.
 */
export function buildMonths(presentMonths: Iterable<string>, currentMonth: string): string[] {
  const set = new Set<string>(presentMonths);
  set.add(currentMonth);
  return [...set].sort();
}

/** Clé d'une case de la grille. */
export function cellKey(patientId: string, mois: string): string {
  return `${patientId}|${mois}`;
}

/**
 * Normalise une valeur brute (Excel ou saisie libre) en tri-état.
 * 'oui'/'OUI'/'Oui' → true ; 'non'/'NON' → false ; le reste (vide, texte) → null.
 */
export function normalizeFacture(raw: unknown): boolean | null {
  if (raw === true || raw === false) return raw;
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "oui" || s === "o" || s === "yes") return true;
  if (s === "non" || s === "n" || s === "no") return false;
  return null;
}

/** Nom lisible du mois pour l'entête ('sept. 2025' / 'Sep 2025'). */
export function formatMonth(mois: string, lang: Lang): string {
  const d = new Date(`${mois}T00:00:00Z`);
  return d.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Compte Oui/Non par mois, pour l'entête (« 42 facturés »). */
export function countBilledByMonth(
  patients: TelecardioPatient[],
  months: string[],
  statutMap: Map<string, boolean | null>
): Map<string, { oui: number; non: number }> {
  const out = new Map<string, { oui: number; non: number }>();
  for (const m of months) {
    let oui = 0;
    let non = 0;
    for (const p of patients) {
      const v = statutMap.get(cellKey(p.id, m));
      if (v === true) oui++;
      else if (v === false) non++;
    }
    out.set(m, { oui, non });
  }
  return out;
}
