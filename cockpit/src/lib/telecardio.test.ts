import { describe, it, expect } from "vitest";
import {
  normalizeFacture,
  buildMonths,
  currentMonthISO,
  cellKey,
  countBilledByMonth,
} from "./telecardio";
import type { TelecardioPatient } from "./types";

// La source Excel mélange « oui », « OUI », vide, « NON » et du texte parasite.
// L'intention réelle est un tri-état : Oui / Non / non renseigné.
describe("normalizeFacture — tri-état depuis des valeurs sales", () => {
  it("« oui » sous toutes ses casses = Oui", () => {
    expect(normalizeFacture("oui")).toBe(true);
    expect(normalizeFacture("OUI")).toBe(true);
    expect(normalizeFacture(" Oui ")).toBe(true);
  });

  it("« non » = Non", () => {
    expect(normalizeFacture("NON")).toBe(false);
    expect(normalizeFacture("non")).toBe(false);
  });

  it("vide, null et texte parasite = non renseigné (null)", () => {
    expect(normalizeFacture("")).toBeNull();
    expect(normalizeFacture(null)).toBeNull();
    expect(normalizeFacture(undefined)).toBeNull();
    expect(normalizeFacture("Avril")).toBeNull(); // un mois écrit dans une case
    expect(normalizeFacture("à partir janvier 2026")).toBeNull();
  });

  it("laisse passer un booléen déjà propre", () => {
    expect(normalizeFacture(true)).toBe(true);
    expect(normalizeFacture(false)).toBe(false);
  });
});

describe("buildMonths — les colonnes à afficher", () => {
  it("garde les mois présents, ajoute le mois courant, trie", () => {
    const months = buildMonths(["2024-05-01", "2024-06-01"], "2025-01-01");
    expect(months).toEqual(["2024-05-01", "2024-06-01", "2025-01-01"]);
  });

  it("ne comble PAS les trous (nov. 2023 puis mai 2024 restent séparés)", () => {
    const months = buildMonths(["2023-11-01", "2024-05-01"], "2024-05-01");
    // Pas de déc./janv./…/avril inventés entre les deux.
    expect(months).toEqual(["2023-11-01", "2024-05-01"]);
  });

  it("le mois courant existe même sans aucune donnée", () => {
    expect(buildMonths([], "2025-09-01")).toEqual(["2025-09-01"]);
  });

  it("ne duplique pas un mois courant déjà présent", () => {
    expect(buildMonths(["2025-09-01"], "2025-09-01")).toEqual(["2025-09-01"]);
  });
});

describe("currentMonthISO — toujours le 1er du mois", () => {
  it("ramène n'importe quel jour au 1er du mois (UTC)", () => {
    expect(currentMonthISO(new Date("2025-09-17T23:30:00Z"))).toBe("2025-09-01");
    expect(currentMonthISO(new Date("2025-01-01T00:00:00Z"))).toBe("2025-01-01");
  });
});

describe("countBilledByMonth — le compteur de l'entête", () => {
  const patients = [
    { id: "a" },
    { id: "b" },
    { id: "c" },
  ] as TelecardioPatient[];

  it("ne compte que les Oui, pas les Non ni les vides", () => {
    const map = new Map<string, boolean | null>([
      [cellKey("a", "2025-09-01"), true],
      [cellKey("b", "2025-09-01"), false],
      [cellKey("c", "2025-09-01"), true],
      // patient « c » n'a rien en août → vide
      [cellKey("a", "2025-08-01"), true],
    ]);
    const counts = countBilledByMonth(patients, ["2025-08-01", "2025-09-01"], map);
    expect(counts.get("2025-09-01")).toEqual({ oui: 2, non: 1 });
    expect(counts.get("2025-08-01")).toEqual({ oui: 1, non: 0 });
  });
});
