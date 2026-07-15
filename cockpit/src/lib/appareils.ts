/**
 * Helpers purs du parc d'appareils : disponibilité par plage de dates, et statut
 * de retour dérivé.
 *
 * Deux décisions de la réunion (juil. 2026) tiennent tout ce module :
 *
 * 1. RÉSERVER À L'AVANCE. « Patient A a pris l'appareil le 1er juin, retour prévu le 6.
 *    Le 4, un médecin veut le réserver à partir du 7 → ça doit passer », en supposant
 *    le retour à l'heure. L'ancien contrôle regardait un état ponctuel (`etat === "Au
 *    cabinet"`) et ignorait complètement les dates : impossible d'exprimer ça.
 *
 * 2. LENDEMAIN. Un appareil attendu lundi n'est réservable qu'à partir de mardi —
 *    il faut le récupérer et le nettoyer.
 *
 * Le statut « Bientôt dû » / « En retard » est CALCULÉ ici, jamais stocké. L'enquête
 * de juil. 2026 a montré que rien n'écrivait « Bientôt dû » (0 ligne sur 8) et que le
 * seul rédacteur d'« En retard » (n8n WF-A2) est désactivé et vise une autre table.
 * Personne ne possédait ces valeurs : les dériver supprime la désynchronisation possible.
 */

/** Une immobilisation : un examen qui tient une unité sur une plage. */
export type Pret = {
  /** notion_id de l'examen */
  id: string;
  /** début (date de pose) 'YYYY-MM-DD' */
  debut: string;
  /** retour prévu 'YYYY-MM-DD' */
  retourPrevu: string | null;
  /** retour effectif 'YYYY-MM-DD' — s'il est posé, l'unité est déjà revenue */
  retourEffectif?: string | null;
};

/** 'YYYY-MM-DD' à partir d'une date ISO éventuellement complète. */
export function jour(d: string | null | undefined): string | null {
  return d ? d.slice(0, 10) : null;
}

/** Lendemain civil (jamais +86 400 000 ms : les changements d'heure cassent ça). */
export function lendemain(dateStr: string): string {
  const d = new Date(dateStr.slice(0, 10) + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Un prêt est en cours tant qu'aucun retour effectif n'est enregistré. */
export function pretOuvert(p: Pret): boolean {
  return !p.retourEffectif;
}

/**
 * Première date à laquelle l'unité est réservable, compte tenu d'un prêt : le
 * LENDEMAIN du retour prévu (décision 2).
 *
 * `null` = jamais réservable de façon sûre : un prêt ouvert sans retour prévu a une
 * fin inconnue. On refuse plutôt que de deviner.
 */
export function libreAPartirDe(p: Pret): string | null {
  if (!pretOuvert(p)) return null; // déjà rendu : n'immobilise plus rien
  if (!p.retourPrevu) return null; // fin inconnue
  return lendemain(p.retourPrevu);
}

/**
 * Fin effective d'immobilisation d'un prêt ouvert : le retour prévu, MAIS jamais dans le
 * passé si l'appareil n'est pas revenu.
 *
 * Un prêt en retard (retour prévu dépassé, aucun retour effectif) immobilise toujours
 * l'appareil : il est physiquement chez le patient. Ne comparer qu'au retour prévu ferait
 * apparaître libre aujourd'hui un boîtier absent depuis une semaine. L'hypothèse « rendu à
 * l'heure » vaut pour le FUTUR ; une fois la date passée sans retour, elle est démentie.
 */
function finImmobilisation(p: Pret, aujourdhui: string): string | null {
  if (!p.retourPrevu) return null; // fin inconnue
  const prevu = jour(p.retourPrevu)!;
  const today = jour(aujourdhui)!;
  return prevu >= today ? prevu : today; // en retard → bloque au moins jusqu'à aujourd'hui
}

/**
 * Un prêt ouvert bloque-t-il une pose au `datePose` demandé ?
 *
 * Règle : bloque tant que `datePose <= fin d'immobilisation` — le lendemain passe, le jour
 * même non.
 *   existant [1er juin → 6 juin], aujourd'hui le 4, demande le 7 → 7 > 6  → libre  ✅ (réunion)
 *   existant [1er juin → 6 juin], aujourd'hui le 4, demande le 6 → 6 <= 6 → bloqué ✅ (lendemain)
 *   existant [1er juin → 6 juin] TOUJOURS DEHORS le 15, demande le 15 → bloqué ✅ (en retard)
 * Un prêt ouvert sans retour prévu bloque toujours : fin inconnue.
 */
export function pretBloque(p: Pret, datePose: string, aujourdhui: string): boolean {
  if (!pretOuvert(p)) return false;
  const pose = jour(datePose)!;
  const fin = finImmobilisation(p, aujourdhui);
  if (!fin) return true; // pas de retour prévu → fin inconnue
  return pose <= fin;
}

/**
 * L'unité est-elle réservable à cette date, compte tenu de tous ses prêts ?
 *
 * `aujourdhui` est REQUIS à dessein. En le laissant défaillir sur `datePose`, tout prêt
 * passé paraissait « en retard » vu depuis une pose lointaine et bloquait à tort — la
 * réservation dos à dos cassait. Le retard est un fait du présent : il faut le vrai jour.
 */
export function uniteDisponible(prets: Pret[], datePose: string, aujourdhui: string): boolean {
  return !prets.some((p) => pretBloque(p, datePose, aujourdhui));
}

/**
 * Première date de pose possible : `aPartirDe` si rien ne bloque, sinon le lendemain de la
 * dernière fin d'immobilisation. `null` si indéterminable (prêt ouvert sans retour prévu)
 * → l'UI doit dire « indisponible », pas inventer une date.
 */
export function prochaineDisponibilite(prets: Pret[], aPartirDe: string, aujourdhui: string): string | null {
  const today = aujourdhui;
  const bloquants = prets.filter((p) => pretBloque(p, aPartirDe, today));
  if (bloquants.length === 0) return jour(aPartirDe);
  if (bloquants.some((p) => !p.retourPrevu)) return null; // fin inconnue

  // La plus tardive des fins d'immobilisation commande.
  const dernier = bloquants
    .map((p) => finImmobilisation(p, today)!)
    .sort()
    .at(-1)!;
  return lendemain(dernier);
}

// ---------- Statut de retour (dérivé, jamais stocké) ----------

export type StatutRetour = "Rendu" | "En retard" | "Bientôt dû" | "Remis";

/**
 * Statut d'un prêt à la date `aujourdhui`.
 * `seuilBientotDu` = nb de jours avant le retour prévu où l'on prévient (défaut 2).
 */
export function statutRetour(p: Pret, aujourdhui: string, seuilBientotDu = 2): StatutRetour {
  if (!pretOuvert(p)) return "Rendu";
  const retour = jour(p.retourPrevu);
  if (!retour) return "Remis"; // pas de date : rien à dire
  const today = jour(aujourdhui)!;
  if (today > retour) return "En retard";
  if (joursEntre(today, retour) <= seuilBientotDu) return "Bientôt dû";
  return "Remis";
}

/** Nombre de jours civils entre deux dates (b - a). Négatif si b précède a. */
export function joursEntre(a: string, b: string): number {
  const da = new Date(jour(a)! + "T00:00:00");
  const dbb = new Date(jour(b)! + "T00:00:00");
  return Math.round((dbb.getTime() - da.getTime()) / 86_400_000);
}

/** Jours de retard (0 si à l'heure ou rendu). */
export function joursDeRetard(p: Pret, aujourdhui: string): number {
  if (!p.retourPrevu) return 0;
  const fin = p.retourEffectif ? jour(p.retourEffectif)! : jour(aujourdhui)!;
  return Math.max(0, joursEntre(jour(p.retourPrevu)!, fin));
}

/**
 * Un prêt en retard fait-il attendre quelqu'un ?
 * Décision 5 de la réunion : quand la date arrive et qu'un patient attend, prévenir
 * l'équipe et notifier les secrétaires.
 */
export function retardBloqueUneReservation(pretEnRetard: Pret, autresPrets: Pret[], aujourdhui: string): boolean {
  if (statutRetour(pretEnRetard, aujourdhui) !== "En retard") return false;
  // Une réservation à venir sur la même unité, dont la pose est déjà atteinte ou dépassée.
  return autresPrets.some(
    (p) => p.id !== pretEnRetard.id && pretOuvert(p) && jour(p.debut)! <= jour(aujourdhui)!
  );
}
