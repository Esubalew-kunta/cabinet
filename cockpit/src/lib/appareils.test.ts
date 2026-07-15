import { describe, it, expect } from "vitest";
import {
  type Pret,
  uniteDisponible,
  pretBloque,
  prochaineDisponibilite,
  libreAPartirDe,
  statutRetour,
  joursDeRetard,
  joursEntre,
  lendemain,
  retardBloqueUneReservation,
} from "./appareils";

const pret = (o: Partial<Pret> = {}): Pret => ({
  id: "ex-1",
  debut: "2026-06-01",
  retourPrevu: "2026-06-06",
  retourEffectif: null,
  ...o,
});

// Le scénario exact de la réunion, mot pour mot :
// « patient A a pris l'appareil X le 1er juin, retour saisi au 6 ; le 4 un médecin
//   vient et veut réserver à partir du 7 → ça doit passer, en supposant le retour
//   à l'heure. »
describe("scénario de la réunion : réserver avant le retour", () => {
  const enCours = pret({ debut: "2026-06-01", retourPrevu: "2026-06-06" });

  it("le 4, réserver pour le 7 est ACCEPTÉ", () => {
    expect(uniteDisponible([enCours], "2026-06-07", "2026-06-04")).toBe(true);
  });

  it("réserver pour le 6 (jour du retour) est REFUSÉ — règle du lendemain", () => {
    expect(uniteDisponible([enCours], "2026-06-06", "2026-06-04")).toBe(false);
  });

  it("réserver pendant le prêt est REFUSÉ", () => {
    expect(uniteDisponible([enCours], "2026-06-04", "2026-06-04")).toBe(false);
    expect(uniteDisponible([enCours], "2026-06-01", "2026-06-01")).toBe(false);
  });

  it("l'unité est annoncée libre à partir du 7", () => {
    expect(libreAPartirDe(enCours)).toBe("2026-06-07");
    expect(prochaineDisponibilite([enCours], "2026-06-04", "2026-06-04")).toBe("2026-06-07");
  });
});

describe("pretBloque", () => {
  it("un prêt rendu ne bloque plus rien", () => {
    const rendu = pret({ retourEffectif: "2026-06-05" });
    expect(pretBloque(rendu, "2026-06-02", "2026-06-02")).toBe(false);
    expect(uniteDisponible([rendu], "2026-06-01", "2026-06-01")).toBe(true);
  });

  it("un prêt ouvert SANS retour prévu bloque toujours — fin inconnue", () => {
    const sansFin = pret({ retourPrevu: null });
    expect(pretBloque(sansFin, "2027-01-01", "2026-06-01")).toBe(true);
    expect(libreAPartirDe(sansFin)).toBeNull();
    expect(prochaineDisponibilite([sansFin], "2026-06-04", "2026-06-04")).toBeNull();
  });

  it("accepte des timestamps ISO complets (colonnes date de Supabase)", () => {
    const p = pret({ retourPrevu: "2026-06-06T00:00:00+00:00" });
    expect(pretBloque(p, "2026-06-07T00:00:00+00:00", "2026-06-04")).toBe(false);
    expect(pretBloque(p, "2026-06-06T00:00:00+00:00", "2026-06-04")).toBe(true);
  });
});

describe("prochaineDisponibilite avec plusieurs prêts", () => {
  it("c'est le retour le plus TARDIF qui commande", () => {
    const prets = [
      pret({ id: "a", retourPrevu: "2026-06-06" }),
      pret({ id: "b", retourPrevu: "2026-06-10" }),
      pret({ id: "c", retourPrevu: "2026-06-02" }),
    ];
    expect(prochaineDisponibilite(prets, "2026-06-01", "2026-06-01")).toBe("2026-06-11");
  });

  it("rien ne bloque → la date demandée elle-même", () => {
    expect(prochaineDisponibilite([], "2026-06-04", "2026-06-04")).toBe("2026-06-04");
    const rendu = pret({ retourEffectif: "2026-06-03" });
    expect(prochaineDisponibilite([rendu], "2026-06-04", "2026-06-04")).toBe("2026-06-04");
  });

  it("un seul prêt sans fin connue rend le tout indéterminable", () => {
    const prets = [pret({ id: "a", retourPrevu: "2026-06-06" }), pret({ id: "b", retourPrevu: null })];
    expect(prochaineDisponibilite(prets, "2026-06-01", "2026-06-01")).toBeNull();
  });

  it("réservations dos à dos : le lendemain de l'une est libre pour l'autre", () => {
    const premier = pret({ id: "a", debut: "2026-06-01", retourPrevu: "2026-06-06" });
    expect(uniteDisponible([premier], "2026-06-07", "2026-06-01")).toBe(true);
    const second = pret({ id: "b", debut: "2026-06-07", retourPrevu: "2026-06-12" });
    expect(uniteDisponible([premier, second], "2026-06-13", "2026-06-01")).toBe(true);
    expect(uniteDisponible([premier, second], "2026-06-12", "2026-06-01")).toBe(false);
  });
});

describe("lendemain / joursEntre — dates civiles", () => {
  it("franchit les fins de mois et d'année", () => {
    expect(lendemain("2026-06-30")).toBe("2026-07-01");
    expect(lendemain("2026-12-31")).toBe("2027-01-01");
    expect(lendemain("2024-02-28")).toBe("2024-02-29"); // bissextile
    expect(lendemain("2026-02-28")).toBe("2026-03-01");
  });

  it("joursEntre", () => {
    expect(joursEntre("2026-06-01", "2026-06-06")).toBe(5);
    expect(joursEntre("2026-06-06", "2026-06-01")).toBe(-5);
    expect(joursEntre("2026-06-01", "2026-06-01")).toBe(0);
  });
});

// Ces valeurs n'avaient AUCUN rédacteur avant (enquête juil. 2026) : « Bientôt dû »
// n'était écrit par personne, « En retard » seulement par un n8n désactivé.
describe("statutRetour — dérivé, jamais stocké", () => {
  const p = pret({ retourPrevu: "2026-06-06" });

  it("En retard une fois la date passée", () => {
    expect(statutRetour(p, "2026-06-07")).toBe("En retard");
    expect(statutRetour(p, "2026-07-01")).toBe("En retard");
  });

  it("Bientôt dû dans les 2 jours", () => {
    expect(statutRetour(p, "2026-06-04")).toBe("Bientôt dû");
    expect(statutRetour(p, "2026-06-06")).toBe("Bientôt dû"); // le jour même
  });

  it("Remis quand l'échéance est lointaine", () => {
    expect(statutRetour(p, "2026-06-01")).toBe("Remis");
  });

  it("Rendu dès qu'un retour effectif est saisi, même en retard", () => {
    expect(statutRetour(pret({ retourEffectif: "2026-06-09" }), "2026-06-20")).toBe("Rendu");
  });

  it("sans retour prévu → Remis (rien à affirmer)", () => {
    expect(statutRetour(pret({ retourPrevu: null }), "2026-06-20")).toBe("Remis");
  });

  it("le seuil est réglable", () => {
    expect(statutRetour(p, "2026-06-01", 5)).toBe("Bientôt dû");
  });
});

describe("joursDeRetard", () => {
  it("compte jusqu'à aujourd'hui tant que non rendu", () => {
    expect(joursDeRetard(pret({ retourPrevu: "2026-06-06" }), "2026-06-09")).toBe(3);
  });

  it("compte jusqu'au retour effectif une fois rendu", () => {
    expect(joursDeRetard(pret({ retourPrevu: "2026-06-06", retourEffectif: "2026-06-08" }), "2026-06-20")).toBe(2);
  });

  it("0 si à l'heure ou sans retour prévu", () => {
    expect(joursDeRetard(pret({ retourPrevu: "2026-06-06" }), "2026-06-05")).toBe(0);
    expect(joursDeRetard(pret({ retourPrevu: null }), "2026-06-20")).toBe(0);
  });
});

// Décision 5 : « quand la date arrive, montrer qu'un autre patient attend
// l'appareil, prévenir l'équipe et notifier les secrétaires. »
describe("retardBloqueUneReservation", () => {
  const enRetard = pret({ id: "a", debut: "2026-06-01", retourPrevu: "2026-06-06" });

  it("vrai quand une réservation a commencé et que l'unité n'est pas revenue", () => {
    const attend = pret({ id: "b", debut: "2026-06-07", retourPrevu: "2026-06-12" });
    expect(retardBloqueUneReservation(enRetard, [attend], "2026-06-08")).toBe(true);
  });

  it("faux si la réservation n'a pas encore commencé", () => {
    const plusTard = pret({ id: "b", debut: "2026-06-20", retourPrevu: "2026-06-25" });
    expect(retardBloqueUneReservation(enRetard, [plusTard], "2026-06-08")).toBe(false);
  });

  it("faux si le prêt n'est pas en retard", () => {
    const attend = pret({ id: "b", debut: "2026-06-07", retourPrevu: "2026-06-12" });
    expect(retardBloqueUneReservation(enRetard, [attend], "2026-06-05")).toBe(false);
  });

  it("faux si personne n'attend — le retard seul ne bloque rien", () => {
    expect(retardBloqueUneReservation(enRetard, [], "2026-06-08")).toBe(false);
  });
});

/**
 * Régression (revue adversariale) : un appareil EN RETARD n'est pas disponible.
 *
 * Le bug : la disponibilité ne se comparait qu'au retour prévu. Un prêt attendu le 6 juin
 * et toujours dehors le 15 laissait « 15 > 6 » → l'appareil paraissait libre… alors qu'il
 * est chez le patient depuis neuf jours. L'ancien code (etat !== "Au cabinet") bloquait ce
 * cas ; le passage aux plages l'avait rouvert.
 *
 * L'hypothèse « rendu à l'heure » vaut pour le FUTUR. Une fois la date passée sans retour,
 * elle est démentie par les faits.
 */
describe("prêt en retard — l'appareil reste immobilisé", () => {
  const enRetard = pret({ debut: "2026-06-01", retourPrevu: "2026-06-06" }); // jamais rendu

  it("le 15 juin, réserver pour le 15 est REFUSÉ (le boîtier est absent)", () => {
    expect(uniteDisponible([enRetard], "2026-06-15", "2026-06-15")).toBe(false);
  });

  it("le 15 juin, réserver pour le 16 est accepté (on suppose un retour aujourd'hui)", () => {
    expect(uniteDisponible([enRetard], "2026-06-16", "2026-06-15")).toBe(true);
  });

  it("la prochaine dispo d'un prêt en retard est demain, pas une date passée", () => {
    expect(prochaineDisponibilite([enRetard], "2026-06-15", "2026-06-15")).toBe("2026-06-16");
  });

  it("le cas de la réunion n'est pas affecté : pas encore en retard", () => {
    // Aujourd'hui le 4, retour prévu le 6 : le 7 reste libre, le 6 reste bloqué.
    expect(uniteDisponible([enRetard], "2026-06-07", "2026-06-04")).toBe(true);
    expect(uniteDisponible([enRetard], "2026-06-06", "2026-06-04")).toBe(false);
    expect(prochaineDisponibilite([enRetard], "2026-06-04", "2026-06-04")).toBe("2026-06-07");
  });

  it("un prêt rendu, même en retard, ne bloque plus", () => {
    const rendu = pret({ debut: "2026-06-01", retourPrevu: "2026-06-06", retourEffectif: "2026-06-09" });
    expect(uniteDisponible([rendu], "2026-06-15", "2026-06-15")).toBe(true);
  });

  it("aujourd'hui est requis : c'est lui qui distingue « à venir » de « en retard »", () => {
    // Même prêt, même date de pose demandée — seule la date du jour change le verdict.
    expect(uniteDisponible([enRetard], "2026-06-07", "2026-06-04")).toBe(true); // pas encore en retard
    expect(uniteDisponible([enRetard], "2026-06-07", "2026-06-15")).toBe(false); // en retard depuis 9 j
  });
});
