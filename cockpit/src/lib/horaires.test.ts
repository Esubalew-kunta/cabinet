import { describe, it, expect } from "vitest";
import {
  blockHours,
  coveredHours,
  monthDates,
  weekDates,
  mondayOf,
  periodDates,
  periodBlocks,
} from "./horaires";

const b = (date: string, debut: string, fin: string) => ({ date, debut, fin });

describe("periodDates", () => {
  it("semaine : 7 jours lundi→dimanche", () => {
    // 2026-07-15 est un mercredi
    expect(periodDates("week", "2026-07-15")).toEqual(weekDates("2026-07-15"));
    expect(periodDates("week", "2026-07-15")).toHaveLength(7);
    expect(mondayOf("2026-07-15")).toBe("2026-07-13");
  });

  it("mois : tous les jours du mois de l'ancre", () => {
    expect(periodDates("month", "2026-07-15")).toEqual(monthDates("2026-07-15"));
    expect(periodDates("month", "2026-07-15")).toHaveLength(31);
    expect(periodDates("month", "2026-02-10")).toHaveLength(28); // 2026 non bissextile
    expect(periodDates("month", "2024-02-10")).toHaveLength(29); // 2024 bissextile
  });
});

describe("periodBlocks", () => {
  it("semaine : ne garde que les blocs de la semaine ancrée", () => {
    const blocks = [
      b("2026-07-12", "09:00", "12:00"), // dimanche précédent
      b("2026-07-13", "09:00", "12:00"), // lundi (dans)
      b("2026-07-19", "09:00", "12:00"), // dimanche (dans)
      b("2026-07-20", "09:00", "12:00"), // lundi suivant
    ];
    expect(periodBlocks("week", "2026-07-15", blocks).map((x) => x.date)).toEqual([
      "2026-07-13",
      "2026-07-19",
    ]);
  });

  // La régression que ce module doit empêcher : la page charge les semaines qui *touchent*
  // le mois, donc un total mensuel naïf compterait les jours des mois voisins.
  it("mois : exclut le débord des mois voisins", () => {
    const blocks = [
      b("2026-06-29", "09:00", "17:00"), // juin — dans la semaine qui touche juillet
      b("2026-06-30", "09:00", "17:00"), // juin
      b("2026-07-01", "09:00", "17:00"), // juillet
      b("2026-07-31", "09:00", "17:00"), // juillet
      b("2026-08-01", "09:00", "17:00"), // août — dans la semaine qui touche juillet
      b("2026-08-02", "09:00", "17:00"), // août
    ];
    const kept = periodBlocks("month", "2026-07-15", blocks).map((x) => x.date);
    expect(kept).toEqual(["2026-07-01", "2026-07-31"]);
    expect(kept.every((d) => d.startsWith("2026-07"))).toBe(true);
  });

  it("mois : l'ancre n'a pas besoin d'être le 1er", () => {
    const blocks = [b("2026-07-01", "09:00", "12:00"), b("2026-08-15", "09:00", "12:00")];
    expect(periodBlocks("month", "2026-07-31", blocks).map((x) => x.date)).toEqual(["2026-07-01"]);
  });

  it("distingue les mêmes jours d'années différentes", () => {
    const blocks = [b("2025-07-15", "09:00", "12:00"), b("2026-07-15", "09:00", "12:00")];
    expect(periodBlocks("month", "2026-07-10", blocks).map((x) => x.date)).toEqual(["2026-07-15"]);
  });

  it("liste vide → vide", () => {
    expect(periodBlocks("month", "2026-07-15", [])).toEqual([]);
    expect(periodBlocks("week", "2026-07-15", [])).toEqual([]);
  });
});

// Le total par secrétaire utilise blockHours (somme brute), la couverture cabinet
// utilise coveredHours (union). Cette distinction ne doit pas être confondue.
describe("blockHours vs coveredHours", () => {
  it("blockHours somme les blocs même s'ils se chevauchent", () => {
    expect(blockHours(b("2026-07-15", "09:00", "12:00"))).toBe(3);
    expect(blockHours(b("2026-07-15", "09:30", "10:00"))).toBe(0.5);
  });

  it("coveredHours dédoublonne les chevauchements, blockHours non", () => {
    // Deux secrétaires présentes 09:00–12:00 le même jour.
    const day = [b("2026-07-15", "09:00", "12:00"), b("2026-07-15", "09:00", "12:00")];
    expect(day.reduce((a, x) => a + blockHours(x), 0)).toBe(6); // 3 h chacune = 6 h payées
    expect(coveredHours(day)).toBe(3); // mais le cabinet n'est couvert que 3 h
  });
});
