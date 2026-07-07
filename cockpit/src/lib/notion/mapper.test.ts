import { describe, it, expect } from "vitest";
import { mapProperty, mapPage } from "./mapper";
import { SOURCES } from "./sources";

describe("mapProperty", () => {
  it("title → texte concaténé", () => {
    expect(mapProperty({ type: "title", title: [{ plain_text: "Mme " }, { plain_text: "Dupont" }] }, "title")).toBe("Mme Dupont");
    expect(mapProperty({ type: "title", title: [] }, "title")).toBeNull();
  });

  it("rich_text → texte ou null", () => {
    expect(mapProperty({ rich_text: [{ plain_text: "note" }] }, "rich_text")).toBe("note");
    expect(mapProperty({ rich_text: [] }, "rich_text")).toBeNull();
  });

  it("number / select / checkbox / email / phone / url", () => {
    expect(mapProperty({ number: 120.5 }, "number")).toBe(120.5);
    expect(mapProperty({ number: null }, "number")).toBeNull();
    expect(mapProperty({ select: { name: "Actif" } }, "select")).toBe("Actif");
    expect(mapProperty({ select: null }, "select")).toBeNull();
    expect(mapProperty({ checkbox: true }, "checkbox")).toBe(true);
    expect(mapProperty({ checkbox: false }, "checkbox")).toBe(false);
    expect(mapProperty({ email: "a@b.fr" }, "email")).toBe("a@b.fr");
    expect(mapProperty({ phone_number: "+33 6 00 00 00 00" }, "phone")).toBe("+33 6 00 00 00 00");
    expect(mapProperty({ url: "https://www.doctolib.fr/x" }, "url")).toBe("https://www.doctolib.fr/x");
  });

  it("multi_select → tableau de noms", () => {
    expect(mapProperty({ multi_select: [{ name: "ECG" }, { name: "Holter" }] }, "multi_select")).toEqual(["ECG", "Holter"]);
    expect(mapProperty({ multi_select: [] }, "multi_select")).toEqual([]);
  });

  it("date → start ISO", () => {
    expect(mapProperty({ date: { start: "2026-07-07", end: null } }, "date")).toBe("2026-07-07");
    expect(mapProperty({ date: null }, "date")).toBeNull();
  });

  it("relation → ids", () => {
    expect(mapProperty({ relation: [{ id: "abc" }, { id: "def" }] }, "relation")).toEqual(["abc", "def"]);
    expect(mapProperty({ relation: [] }, "relation")).toEqual([]);
  });

  it("unique_id (PSID) → nombre", () => {
    expect(mapProperty({ unique_id: { prefix: "PSID", number: 42 } }, "unique_id")).toBe(42);
  });

  it("propriété absente → null / [] selon le type", () => {
    expect(mapProperty(undefined, "select")).toBeNull();
    expect(mapProperty(undefined, "relation")).toEqual([]);
    expect(mapProperty(undefined, "multi_select")).toEqual([]);
  });
});

describe("mapPage", () => {
  const patientsSpec = SOURCES.find((s) => s.table === "patients")!;

  it("mappe une page patient complète (fixture réaliste)", () => {
    const page = {
      id: "11111111-2222-3333-4444-555555555555",
      created_time: "2026-07-01T09:00:00.000Z",
      last_edited_time: "2026-07-06T10:00:00.000Z",
      properties: {
        Nom: { type: "title", title: [{ plain_text: "Martin Claire" }] },
        "Nom complet": { rich_text: [{ plain_text: "Claire Martin" }] },
        PSID: { unique_id: { prefix: "PSID", number: 7 } },
        Statut: { select: { name: "Actif" } },
        "Type patient": { select: { name: "Existant" } },
        "Problème principal": { select: { name: "FA suivi" } },
        "Niveau de vigilance": { select: { name: "Routine" } },
        Téléphone: { phone_number: "+33600000001" },
        Email: { email: "claire@exemple.fr" },
        "Lien Doctolib": { url: "https://www.doctolib.fr/claire" },
        "Prochain RDV": { date: { start: "2026-07-15T14:30:00.000+02:00" } },
        "Médecin assigné": { relation: [{ id: "med-1" }] },
      },
    };
    const row = mapPage(page, patientsSpec);
    expect(row.notion_id).toBe(page.id);
    expect(row.nom).toBe("Martin Claire");
    expect(row.psid).toBe(7);
    expect(row.statut).toBe("Actif");
    expect(row.lien_doctolib).toBe("https://www.doctolib.fr/claire");
    expect(row.prochain_rdv).toBe("2026-07-15T14:30:00.000+02:00");
    expect(row.medecin_assigne).toEqual(["med-1"]);
    expect(row.raw).toBe(page.properties); // rien n'est perdu
    // propriétés absentes → null / []
    expect(row.dernier_rdv).toBeNull();
    expect(row.email_1).toBeNull();
  });

  it("retrouve le titre même si son nom diffère (base perso inconnue)", () => {
    const persoSpec = SOURCES.find((s) => s.table === "taches_perso")!;
    const page = {
      id: "99999999-8888-7777-6666-555555555555",
      properties: {
        Nom: { type: "title", title: [{ plain_text: "Payer l'assurance" }] },
      },
    };
    const row = mapPage(page, persoSpec);
    expect(row.titre).toBe("Payer l'assurance");
  });

  it("chaque spec cible des colonnes uniques", () => {
    for (const spec of SOURCES) {
      const cols = spec.props.map((p) => p.column);
      expect(new Set(cols).size).toBe(cols.length);
    }
  });
});
