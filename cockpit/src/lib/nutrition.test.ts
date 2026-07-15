import { describe, it, expect } from "vitest";
import { partMedecin, tauxPartMedecin, PART_MEDECIN_PCT_DEFAUT } from "./nutrition";

// « Combien donner au médecin qui a traité le patient, sur ce que le patient A PAYÉ. »
// Le mot « payé » est la spécification : la base est l'encaissé, jamais le facturé.
describe("partMedecin — la base est ce que le patient a payé", () => {
  it("50 % de 400 € encaissés = 200 €, le cabinet garde 200 €", () => {
    expect(partMedecin(400, 50)).toEqual({ encaisse: 400, part: 200, cabinet: 200, manuel: false });
  });

  it("un forfait facturé mais NON payé ne reverse rien", () => {
    // Le cas réel du jour : une ligne « Perfusion nutrition » à 497 € dus, 0 € payé.
    expect(partMedecin(0, 50)).toEqual({ encaisse: 0, part: 0, cabinet: 0, manuel: false });
  });

  it("un paiement PARTIEL ne reverse que sur ce qui est rentré", () => {
    // Facturé 400, payé 200 → 100, et non 200 : on ne reverse pas sur de l'argent absent.
    expect(partMedecin(200, 50).part).toBe(100);
  });

  it("arrondi au centime", () => {
    expect(partMedecin(350, 33).part).toBe(115.5);
    expect(partMedecin(497, 33).part).toBe(164.01);
  });

  it("un montant négatif ou absent vaut 0", () => {
    expect(partMedecin(null, 50).part).toBe(0);
    expect(partMedecin(undefined, 50).part).toBe(0);
    expect(partMedecin(-100, 50).part).toBe(0);
  });
});

// « Honoraire IPA » existait avant ce calcul : là où un montant est saisi, c'est un accord
// déjà passé — le taux ne doit pas le réécrire.
describe("partMedecin — un montant saisi prime sur le taux", () => {
  it("l'honoraire saisi est reversé tel quel, pas le pourcentage", () => {
    const r = partMedecin(400, 50, 175);
    expect(r.part).toBe(175); // et non 200
    expect(r.cabinet).toBe(225);
    expect(r.manuel).toBe(true);
  });

  it("un honoraire supérieur à l'encaissé est plafonné à l'encaissé", () => {
    // Sinon le cabinet reverserait de l'argent qu'il n'a pas reçu.
    const r = partMedecin(150, 50, 200);
    expect(r.part).toBe(150);
    expect(r.cabinet).toBe(0);
  });

  it("0 ou null = pas de saisie → le taux s'applique", () => {
    expect(partMedecin(400, 50, null).manuel).toBe(false);
    expect(partMedecin(400, 50, 0).part).toBe(200);
  });

  it("rien d'encaissé : même un honoraire saisi ne crée pas de dette", () => {
    expect(partMedecin(0, 50, 175).part).toBe(0);
  });
});

describe("tauxPartMedecin — lecture du réglage", () => {
  it("lit un pourcentage", () => {
    expect(tauxPartMedecin("40")).toBe(40);
    expect(tauxPartMedecin(" 40 ")).toBe(40);
    expect(tauxPartMedecin("40%")).toBe(40);
    expect(tauxPartMedecin("33,5")).toBe(33.5); // virgule décimale française
  });

  it("0 et 100 sont valides", () => {
    expect(tauxPartMedecin("0")).toBe(0);
    expect(tauxPartMedecin("100")).toBe(100);
  });

  it("absent, vide ou illisible → le défaut", () => {
    expect(tauxPartMedecin(null)).toBe(PART_MEDECIN_PCT_DEFAUT);
    expect(tauxPartMedecin("")).toBe(PART_MEDECIN_PCT_DEFAUT);
    expect(tauxPartMedecin("beaucoup")).toBe(PART_MEDECIN_PCT_DEFAUT);
  });

  it("hors bornes → le défaut, pas une part absurde", () => {
    expect(tauxPartMedecin("900")).toBe(PART_MEDECIN_PCT_DEFAUT);
    expect(tauxPartMedecin("-10")).toBe(PART_MEDECIN_PCT_DEFAUT);
  });
});
