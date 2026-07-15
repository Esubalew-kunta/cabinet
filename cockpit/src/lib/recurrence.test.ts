import { describe, it, expect } from "vitest";
import {
  prochaineEcheance,
  addMonthsClamped,
  addDaysCivil,
  nextWeekday,
  isWeekend,
  lastDayOfMonth,
  estRecurrente,
} from "./recurrence";

describe("les cas de la réunion", () => {
  it("« tous les lundis » = weekly + échéance un lundi", () => {
    // 2026-07-13 est un lundi
    expect(new Date("2026-07-13T00:00:00").getDay()).toBe(1);
    const next = prochaineEcheance("weekly", "2026-07-13");
    expect(next).toBe("2026-07-20");
    expect(new Date(next + "T00:00:00").getDay()).toBe(1); // toujours un lundi
  });

  it("« le loyer le 5 » = monthly + échéance le 5", () => {
    expect(prochaineEcheance("monthly", "2026-07-05")).toBe("2026-08-05");
    expect(prochaineEcheance("monthly", "2026-12-05")).toBe("2027-01-05"); // passage d'année
  });

  it("« chaque jour ouvré » saute le week-end", () => {
    expect(prochaineEcheance("weekdays", "2026-07-17")).toBe("2026-07-20"); // ven → lun
    expect(prochaineEcheance("weekdays", "2026-07-13")).toBe("2026-07-14"); // lun → mar
  });
});

describe("prochaineEcheance", () => {
  it("daily : +1 jour, y compris le week-end", () => {
    expect(prochaineEcheance("daily", "2026-07-17")).toBe("2026-07-18"); // ven → sam
  });

  it("yearly : même date l'année suivante", () => {
    expect(prochaineEcheance("yearly", "2026-03-15")).toBe("2027-03-15");
  });

  it("accepte un timestamp ISO complet (colonne echeance = timestamptz)", () => {
    expect(prochaineEcheance("weekly", "2026-07-13T00:00:00+00:00")).toBe("2026-07-20");
  });

  it("fréquence inconnue ou échéance vide → null", () => {
    expect(prochaineEcheance("bogus", "2026-07-13")).toBeNull();
    expect(prochaineEcheance(null, "2026-07-13")).toBeNull();
    expect(prochaineEcheance("weekly", "")).toBeNull();
  });
});

describe("addMonthsClamped — le piège des mois courts", () => {
  it("31 janvier → 28 février (2026 non bissextile)", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("31 janvier → 29 février (2024 bissextile)", () => {
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("31 mars → 30 avril (mois de 30 jours)", () => {
    expect(addMonthsClamped("2026-03-31", 1)).toBe("2026-04-30");
  });

  // LA régression à empêcher : sans anchorDay, une série « le 31 » passée par février
  // resterait au 28 pour toujours — le loyer glisserait de trois jours, en silence.
  it("SANS anchorDay la série dérive après un mois court", () => {
    const fev = addMonthsClamped("2026-01-31", 1); // 2026-02-28
    expect(addMonthsClamped(fev, 1)).toBe("2026-03-28"); // ✗ devrait être le 31
  });

  it("AVEC anchorDay la série se rétablit au quantième d'origine", () => {
    const fev = addMonthsClamped("2026-01-31", 1, 31); // 2026-02-28
    expect(fev).toBe("2026-02-28");
    expect(addMonthsClamped(fev, 1, 31)).toBe("2026-03-31"); // ✓ rétabli
    expect(addMonthsClamped("2026-03-31", 1, 31)).toBe("2026-04-30"); // puis re-borné
    expect(addMonthsClamped("2026-04-30", 1, 31)).toBe("2026-05-31"); // puis rétabli
  });

  it("29 février → 28 février en année non bissextile (yearly)", () => {
    expect(prochaineEcheance("yearly", "2024-02-29")).toBe("2025-02-28");
  });

  it("le 5 ne subit jamais de bornage", () => {
    let d = "2026-01-05";
    for (const attendu of ["2026-02-05", "2026-03-05", "2026-04-05"]) {
      d = addMonthsClamped(d, 1, 5);
      expect(d).toBe(attendu);
    }
  });
});

describe("helpers", () => {
  it("lastDayOfMonth", () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2024, 2)).toBe(29);
    expect(lastDayOfMonth(2026, 4)).toBe(30);
    expect(lastDayOfMonth(2026, 12)).toBe(31);
  });

  it("isWeekend", () => {
    expect(isWeekend("2026-07-18")).toBe(true); // samedi
    expect(isWeekend("2026-07-19")).toBe(true); // dimanche
    expect(isWeekend("2026-07-17")).toBe(false); // vendredi
  });

  it("nextWeekday saute tout le week-end", () => {
    expect(nextWeekday("2026-07-17")).toBe("2026-07-20"); // ven → lun
    expect(nextWeekday("2026-07-18")).toBe("2026-07-20"); // sam → lun
  });

  it("addDaysCivil franchit les fins de mois et d'année", () => {
    expect(addDaysCivil("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysCivil("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("estRecurrente exige Calendrier ET une fréquence", () => {
    expect(estRecurrente("Récurrente", "weekly")).toBe(true);
    expect(estRecurrente("Récurrente", null)).toBe(false); // le garde-fou de creerTache
    expect(estRecurrente("Ponctuelle", "weekly")).toBe(false);
  });
});

/**
 * Régression : « arrêter la récurrence » doit vraiment l'arrêter.
 *
 * Le bug (trouvé en revue adversariale) : arreterRecurrence ne repassait que l'instance
 * cliquée en « Ponctuelle ». Ses sœurs déjà clôturées restaient « Récurrente » avec le même
 * groupe, et le filet du cron repartait d'une sœur arbitraire → la série ressuscitait, avec
 * en prime un doublon de l'instance qu'on venait de fermer.
 *
 * La règle qui corrige : ne régénérer QUE depuis l'instance la plus récente du groupe, et
 * seulement si elle est encore « Récurrente ». On teste ici cette règle de sélection, qui
 * est le cœur du correctif (rattraperRecurrences lui-même parle à la base).
 */
describe("arrêt d'une série — règle de sélection du filet", () => {
  type Row = { id: string; echeance: string; calendrier: string; statut: string };

  /** Reproduit la décision de rattraperRecurrences : régénérer, ou non ? */
  const doitRegenerer = (groupe: Row[]): boolean => {
    const derniere = [...groupe].sort((a, b) => b.echeance.localeCompare(a.echeance))[0];
    if (!derniere) return false;
    if (derniere.calendrier !== "Récurrente") return false; // série arrêtée
    return !groupe.some((r) => r.statut !== "Terminé"); // une instance ouverte ? rien à faire
  };

  it("série arrêtée puis clôturée → le cron NE ressuscite PAS", () => {
    const groupe: Row[] = [
      { id: "a", echeance: "2026-06-01", calendrier: "Récurrente", statut: "Terminé" },
      { id: "b", echeance: "2026-06-08", calendrier: "Récurrente", statut: "Terminé" },
      // celle-ci a été arrêtée puis clôturée — c'est la plus récente
      { id: "c", echeance: "2026-06-15", calendrier: "Ponctuelle", statut: "Terminé" },
    ];
    expect(doitRegenerer(groupe)).toBe(false);
  });

  it("l'ancien comportement (repartir d'une sœur) aurait ressuscité", () => {
    const groupe: Row[] = [
      { id: "a", echeance: "2026-06-01", calendrier: "Récurrente", statut: "Terminé" },
      { id: "b", echeance: "2026-06-08", calendrier: "Récurrente", statut: "Terminé" },
      { id: "c", echeance: "2026-06-15", calendrier: "Ponctuelle", statut: "Terminé" },
    ];
    // Le bug : filtrer sur calendrier='Récurrente' PUIS prendre la première fait remonter
    // « b » — une sœur — alors que la série a été arrêtée.
    const soeurRecurrenteLaPlusRecente = groupe
      .filter((r) => r.calendrier === "Récurrente" && r.statut === "Terminé")
      .sort((a, b) => b.echeance.localeCompare(a.echeance))[0];
    expect(soeurRecurrenteLaPlusRecente?.id).toBe("b"); // ← ce que faisait l'ancien code
    // et la nouvelle règle l'ignore, parce que « b » n'est pas la plus récente du groupe.
  });

  it("série en cours dont la dernière est clôturée sans successeur → le cron répare", () => {
    const groupe: Row[] = [
      { id: "a", echeance: "2026-06-01", calendrier: "Récurrente", statut: "Terminé" },
      { id: "b", echeance: "2026-06-08", calendrier: "Récurrente", statut: "Terminé" },
    ];
    expect(doitRegenerer(groupe)).toBe(true);
  });

  it("une instance encore ouverte → le cron ne crée rien (idempotence)", () => {
    const groupe: Row[] = [
      { id: "a", echeance: "2026-06-01", calendrier: "Récurrente", statut: "Terminé" },
      { id: "b", echeance: "2026-06-08", calendrier: "Récurrente", statut: "À faire" },
    ];
    expect(doitRegenerer(groupe)).toBe(false);
  });
});
