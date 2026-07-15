/**
 * Helpers purs du module Horaires (heures de travail des secrétaires).
 * Aucune dépendance serveur — utilisable côté page ET côté client.
 * Temps stockés en 'HH:mm' ; dates en 'YYYY-MM-DD'.
 */

import type { Horaire } from "@/lib/types";

// ---------- Couleurs par secrétaire (déterministes, sans purge Tailwind) ----------
// Teintes lisibles en clair comme en sombre. Utilisées en style inline.
export const SECRETARY_PALETTE = [
  "#0d9488", // teal
  "#2563eb", // blue
  "#7c3aed", // violet
  "#d97706", // amber
  "#e11d48", // rose
  "#059669", // emerald
  "#ea580c", // orange
  "#4f46e5", // indigo
] as const;

/** Couleur stable d'une secrétaire selon sa position dans la liste ordonnée. */
export function secretaryColor(secretaireId: string, orderedIds: string[]): string {
  const i = orderedIds.indexOf(secretaireId);
  const idx = i >= 0 ? i : Math.abs(hashCode(secretaireId));
  return SECRETARY_PALETTE[idx % SECRETARY_PALETTE.length];
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}

// ---------- Temps ----------
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

export function fromMinutes(mins: number): string {
  const m = Math.max(0, Math.min(24 * 60, Math.round(mins)));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Durée d'un bloc en heures (décimal). */
export function blockHours(h: Pick<Horaire, "debut" | "fin">): number {
  return Math.max(0, (toMinutes(h.fin) - toMinutes(h.debut)) / 60);
}

export function isValidRange(debut: string, fin: string): boolean {
  return toMinutes(fin) > toMinutes(debut);
}

/** Deux blocs se chevauchent-ils (mêmes bornes ouvertes) ? */
export function overlaps(a: Pick<Horaire, "debut" | "fin">, b: Pick<Horaire, "debut" | "fin">): boolean {
  return toMinutes(a.debut) < toMinutes(b.fin) && toMinutes(b.debut) < toMinutes(a.fin);
}

// ---------- Dates & semaines (semaine commençant le LUNDI) ----------
/** Lundi de la semaine contenant `dateStr` (ou aujourd'hui). Retourne 'YYYY-MM-DD'. */
export function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const dow = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - dow);
  return isoDate(d);
}

/** Les 7 dates (lundi→dimanche) de la semaine ancrée sur `anchorDate`. */
export function weekDates(anchorDate: string): string[] {
  const monday = new Date(mondayOf(anchorDate) + "T00:00:00");
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return isoDate(d);
  });
}

/** Décale une date de `days` jours. */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/** Décale une date de `months` mois. */
export function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return isoDate(d);
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Semaine ISO 'YYYY-Www' (norme ISO-8601, jeudi de référence). */
export function isoWeek(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3); // jeudi de la semaine
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstDayNr = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNr + 3);
  const week = 1 + Math.round((target.valueOf() - firstThursday.valueOf()) / (7 * 24 * 3600 * 1000));
  return `${target.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Toutes les dates d'un mois (jour 1 → dernier jour), 'YYYY-MM-DD'. */
export function monthDates(anchorDate: string): string[] {
  const d = new Date(anchorDate + "T00:00:00");
  const y = d.getFullYear(), m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  return Array.from({ length: last }, (_, i) => isoDate(new Date(y, m, i + 1)));
}

// ---------- Période affichée (onglet semaine / mois) ----------
/** Les jours à agréger pour la période affichée. */
export function periodDates(view: "week" | "month", anchorDate: string): string[] {
  return view === "month" ? monthDates(anchorDate) : weekDates(anchorDate);
}

/**
 * Les blocs à agréger pour la période affichée.
 *
 * La page charge toutes les semaines qui *touchent* le mois (lundi de la 1re → dimanche de la
 * dernière) : en vue mois, filtrer sur le mois de l'ancre est obligatoire, sinon les jours
 * débordants des mois voisins seraient comptés dans les totaux.
 */
export function periodBlocks<T extends { date: string }>(
  view: "week" | "month",
  anchorDate: string,
  blocks: T[]
): T[] {
  if (view === "month") {
    const ym = anchorDate.slice(0, 7);
    return blocks.filter((b) => b.date.slice(0, 7) === ym);
  }
  const week = weekDates(anchorDate);
  return blocks.filter((b) => b.date >= week[0] && b.date <= week[6]);
}

// ---------- Intervalles & couverture ----------
export type Interval = { start: number; end: number }; // minutes depuis minuit

/** Fusionne des intervalles qui se chevauchent/se touchent. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

/** Union couverte (minutes) d'une liste de blocs sur un jour. */
export function coveredIntervals(blocks: Pick<Horaire, "debut" | "fin">[]): Interval[] {
  return mergeIntervals(blocks.map((b) => ({ start: toMinutes(b.debut), end: toMinutes(b.fin) })));
}

/** Trous : minutes des heures d'ouverture NON couvertes par au moins une secrétaire. */
export function gapIntervals(blocks: Pick<Horaire, "debut" | "fin">[], opStart: string, opEnd: string): Interval[] {
  const oS = toMinutes(opStart), oE = toMinutes(opEnd);
  const covered = coveredIntervals(blocks).filter((iv) => iv.end > oS && iv.start < oE);
  const gaps: Interval[] = [];
  let cursor = oS;
  for (const iv of covered) {
    const s = Math.max(iv.start, oS);
    if (s > cursor) gaps.push({ start: cursor, end: s });
    cursor = Math.max(cursor, Math.min(iv.end, oE));
  }
  if (cursor < oE) gaps.push({ start: cursor, end: oE });
  return gaps;
}

/** Total d'heures couvertes (union, sans double-compte) pour un jour. */
export function coveredHours(blocks: Pick<Horaire, "debut" | "fin">[]): number {
  return coveredIntervals(blocks).reduce((s, iv) => s + (iv.end - iv.start), 0) / 60;
}
