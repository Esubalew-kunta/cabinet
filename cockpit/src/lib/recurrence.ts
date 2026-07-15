/**
 * Helpers purs de la récurrence des tâches.
 *
 * Principe (décision réunion juil. 2026) : **le motif, c'est l'échéance**.
 * Aucun sélecteur de jour de semaine ni de quantième — l'échéance porte déjà les deux :
 *   « tous les lundis »   = weekly  + échéance un lundi   → +7 j
 *   « le loyer le 5 »     = monthly + échéance le 5       → le 5 du mois suivant
 *   « chaque jour ouvré » = weekdays                      → +1 j en sautant sam./dim.
 *
 * Tout est calculé en dates civiles ('YYYY-MM-DD'), jamais en millisecondes : ajouter
 * 86 400 000 ms casse aux changements d'heure (une journée fait 23 ou 25 h deux fois par an).
 */

import type { RecurrenceKey } from "@/lib/labels";

/** 'YYYY-MM-DD' d'un Date local. */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parse 'YYYY-MM-DD' (ou un ISO complet) en Date locale à minuit. */
function parse(dateStr: string): Date {
  return new Date(dateStr.slice(0, 10) + "T00:00:00");
}

/** Dernier jour du mois (1-12 → 28..31), gère les années bissextiles. */
export function lastDayOfMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

/**
 * Ajoute `n` mois en gardant le quantième d'origine, borné au dernier jour du mois.
 *
 * `anchorDay` est le quantième de la série (celui de la PREMIÈRE échéance), pas celui de
 * l'instance courante : sans lui, une série « le 31 » passée par février resterait bloquée
 * au 28 pour toujours. C'est le piège classique de ce genre de calcul.
 */
export function addMonthsClamped(dateStr: string, n: number, anchorDay?: number): string {
  const d = parse(dateStr);
  const day = anchorDay ?? d.getDate();
  const y = d.getFullYear();
  const m = d.getMonth() + n; // peut déborder : Date normalise
  const target = new Date(y, m, 1);
  const ty = target.getFullYear();
  const tm = target.getMonth() + 1;
  return iso(new Date(ty, tm - 1, Math.min(day, lastDayOfMonth(ty, tm))));
}

/** Ajoute `n` jours civils. */
export function addDaysCivil(dateStr: string, n: number): string {
  const d = parse(dateStr);
  d.setDate(d.getDate() + n);
  return iso(d);
}

/** true si samedi ou dimanche. */
export function isWeekend(dateStr: string): boolean {
  const dow = parse(dateStr).getDay();
  return dow === 0 || dow === 6;
}

/** Prochain jour ouvré strictement après `dateStr`. */
export function nextWeekday(dateStr: string): string {
  let d = addDaysCivil(dateStr, 1);
  while (isWeekend(d)) d = addDaysCivil(d, 1);
  return d;
}

/**
 * Échéance de l'instance suivante d'une série récurrente.
 *
 * @param frequency  option Notion « Récurrence » (daily | weekdays | weekly | monthly | yearly)
 * @param from       échéance de l'instance qui vient d'être clôturée ('YYYY-MM-DD' ou ISO)
 * @param anchorDay  quantième de la série (monthly/yearly) — voir addMonthsClamped
 * @returns 'YYYY-MM-DD', ou null si la fréquence est inconnue
 */
export function prochaineEcheance(
  frequency: string | null,
  from: string,
  anchorDay?: number
): string | null {
  if (!from) return null;
  const suivante = roulerDate(frequency, from.slice(0, 10), anchorDay);
  if (!suivante) return null;
  // L'HEURE SURVIT AU REPORT. « Appeler le labo à 9 h » toutes les semaines doit rester à
  // 9 h : en ne rendant que 'YYYY-MM-DD', l'instance suivante retombait à minuit — l'heure
  // disparaissait de l'écran (`formatDate` ne l'affiche que si elle existe) et la tâche
  // s'affichait « en retard » dès 00 h 00 le jour même. Une échéance sans heure (tâche
  // « toute la journée ») n'a pas de suffixe : elle en reste dépourvue.
  return suivante + from.slice(10);
}

/** Le report pur, sur la seule partie date. */
function roulerDate(frequency: string | null, base: string, anchorDay?: number): string | null {
  switch (frequency as RecurrenceKey) {
    case "daily":
      return addDaysCivil(base, 1);
    case "weekdays":
      return nextWeekday(base);
    case "weekly":
      // +7 j garde mécaniquement le même jour de la semaine.
      return addDaysCivil(base, 7);
    case "monthly":
      return addMonthsClamped(base, 1, anchorDay);
    case "yearly":
      return addMonthsClamped(base, 12, anchorDay);
    default:
      return null;
  }
}

/** Une tâche est récurrente si Calendrier = « Récurrente » ET une fréquence est posée. */
export function estRecurrente(calendrier: string | null, recurrence: string | null): boolean {
  return calendrier === "Récurrente" && !!recurrence;
}
