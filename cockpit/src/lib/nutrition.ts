/**
 * Nutrition — la part à reverser au praticien.
 *
 * Demande de juil. 2026 : « combien donner au médecin qui a traité le patient, sur ce que
 * le patient A PAYÉ ».
 *
 * DEUX RÈGLES PORTENT TOUT :
 *
 * 1. LA BASE EST L'ENCAISSÉ, PAS LE FACTURÉ. « ce que le patient a payé » = `montant_payé`,
 *    jamais `montant_dû`. Une séance facturée 400 € et payée 200 € ne doit pas produire une
 *    part calculée sur 400 : on reverserait sur de l'argent qui n'est pas rentré. Un impayé
 *    donne donc 0, et la part grandit au fil des encaissements.
 *
 * 2. UN MONTANT SAISI À LA MAIN PRIME SUR LE TAUX. `Honoraire IPA` existait avant ce calcul
 *    (150-200 € sur un forfait de 350-400 €). Là où il est renseigné, c'est un accord déjà
 *    passé : on l'affiche tel quel plutôt que de le réécrire avec un pourcentage. Le taux
 *    n'est qu'un défaut pour tout le reste.
 *
 * Aucune écriture : la part est dérivée à la lecture, comme le statut des appareils. Rien à
 * désynchroniser, et changer le taux dans /admin re-calcule tout l'historique d'un coup —
 * ce qui est le comportement voulu tant que rien n'est « figé » à la clôture du mois.
 */

/** Le taux par défaut si le réglage est absent ou illisible. */
export const PART_MEDECIN_PCT_DEFAUT = 50;

/**
 * Lit `nutrition_part_medecin_pct` (une chaîne, côté Paramètres) et le borne à 0-100.
 * Une valeur vide, non numérique ou hors bornes retombe sur le défaut plutôt que de
 * produire une part absurde (un taux à 900 % se verrait, un taux à -10 % moins).
 */
export function tauxPartMedecin(valeur: string | null | undefined): number {
  if (valeur == null) return PART_MEDECIN_PCT_DEFAUT;
  const brut = String(valeur).trim().replace(",", ".").replace("%", "").trim();
  // `Number("")` vaut 0 — fini, et dans les bornes. Sans ce garde-fou, un réglage VIDE
  // (celui qu'on obtient en effaçant le champ dans /admin) ne retomberait pas sur le
  // défaut : il vaudrait 0 %, et plus personne ne serait payé, sans un mot.
  if (brut === "") return PART_MEDECIN_PCT_DEFAUT;
  const n = Number(brut);
  if (!Number.isFinite(n)) return PART_MEDECIN_PCT_DEFAUT;
  if (n < 0 || n > 100) return PART_MEDECIN_PCT_DEFAUT;
  return n;
}

export type PartMedecin = {
  /** Ce que le patient a effectivement versé. */
  encaisse: number;
  /** Ce qui revient au praticien. */
  part: number;
  /** Ce qui reste au cabinet. */
  cabinet: number;
  /** `true` si la part vient d'un montant saisi, `false` si elle vient du taux. */
  manuel: boolean;
};

/**
 * La part du praticien pour une séance.
 *
 * `honoraireManuel` = la colonne `Honoraire IPA` si elle est renseignée (règle 2).
 * Arrondi au centime : un taux de 33 % sur 350 € donne 115,50 €, pas 115,4999….
 */
export function partMedecin(
  encaissePatient: number | null | undefined,
  tauxPct: number,
  honoraireManuel?: number | null
): PartMedecin {
  const encaisse = Math.max(0, Number(encaissePatient ?? 0));

  // Rien d'encaissé → rien à reverser, même si un honoraire est noté : la règle est
  // « sur ce que le patient a payé ». Sinon une séance impayée générerait une dette.
  if (encaisse === 0) return { encaisse: 0, part: 0, cabinet: 0, manuel: false };

  if (honoraireManuel != null && Number.isFinite(honoraireManuel) && honoraireManuel > 0) {
    // Jamais plus que ce qui est rentré : un honoraire de 200 € sur 150 € encaissés
    // reverserait de l'argent que le cabinet n'a pas.
    const part = Math.min(round2(honoraireManuel), encaisse);
    return { encaisse, part, cabinet: round2(encaisse - part), manuel: true };
  }

  const part = round2((encaisse * tauxPct) / 100);
  return { encaisse, part, cabinet: round2(encaisse - part), manuel: false };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
