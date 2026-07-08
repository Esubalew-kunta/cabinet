/**
 * Remise à zéro des données de démo + seed des données réelles.
 * - Archive toutes les lignes de : patients, dossiers, examens, paiements,
 *   perfusions, taches, taches_perso, rapports. (Notion "archive" = corbeille,
 *   récupérable 30 jours — rien n'est détruit.)
 * - Paramètres : INTOUCHÉ (tarifs, offsets, test_mode).
 * - Personnel : renomme/complète l'équipe réelle, archive les fiches de démo,
 *   sans toucher les fiches liées à un compte app_members.
 * - Appareils : seed du parc physique (Holter rythmique 1-5, tensionnel 1,
 *   polygraphie 1-2, moniteur ECG 1), tous "Au cabinet".
 *
 * Usage: node scripts/clear-and-seed.mjs
 */
import { notionClient, DS, withRetry } from "./notion-env.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { appareilsDataSourceId } = JSON.parse(readFileSync(join(here, ".notion-appareils.json"), "utf8"));
const notion = notionClient();
const log = (...a) => console.log("[seed]", ...a);

async function queryAll(dataSourceId) {
  const rows = [];
  let cursor = undefined;
  do {
    const res = await withRetry(() =>
      notion.dataSources.query({ data_source_id: dataSourceId, page_size: 100, start_cursor: cursor })
    );
    rows.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return rows;
}

async function archiveAll(name, dataSourceId) {
  const rows = await queryAll(dataSourceId);
  let n = 0;
  for (const row of rows) {
    await withRetry(() => notion.pages.update({ page_id: row.id, archived: true }));
    n++;
  }
  log(`${name}: ${n} ligne(s) archivée(s)`);
}

const title = (p, prop = "Nom") => p.properties[prop]?.title?.map((t) => t.plain_text).join("") ?? "";

async function main() {
  // ── 1. Vider les données opérationnelles de démo
  for (const [name, id] of [
    ["Dossiers", DS.dossiers],
    ["Examens", DS.examens],
    ["Paiements", DS.paiements],
    ["Perfusions", DS.perfusions],
    ["Tâches", DS.taches],
    ["Tâches perso", DS.taches_perso],
    ["Rapports", DS.rapports],
    ["Patients", DS.patients],
  ]) {
    await archiveAll(name, id);
  }

  // ── 2. Personnel : équipe réelle
  const KEEP = {
    // nom actuel → { nouveau nom, Rôle, Spécialité }
    "Dr. Sana Amraoui": { role: "Médecin", spec: "Cardiologue-rythmologue" },
    "Dr Zouheir": { role: "Médecin", spec: "Cardiologue" },
    "Dr Chaouki": { role: "Externe", spec: "Pneumologue" },
    "Rita (IPA)": { role: "IPA", spec: "IPA" },
    "Secrétaire cabinet 1": { role: "Secrétaire", spec: "Secrétaire" },
    "Secrétaire cabinet 2": { role: "Secrétaire", spec: "Secrétaire" },
    "Secrétaire personnelle": { role: "Secrétaire", spec: "Secrétaire" },
    "Kunta (Esubalew)": { role: "Admin", spec: null },
  };
  const ARCHIVE = ["Médecins bilan cardio", "Médecins American Hospital", "Secrétaire (à nommer)"];
  const CREATE = [
    { nom: "Dr Sofiane", role: "Médecin", spec: "Cardiologue" },
    { nom: "Dr Leslie Berdah Sadaoui", role: "Médecin", spec: "Nutrition" },
    { nom: "Pr Fabien Doguet", role: "Médecin", spec: "Chirurgien cardiaque" },
    { nom: "Dr Adam Taha", role: "Médecin", spec: "Chirurgien vasculaire" },
    { nom: "Dr Hakem Rabiaa", role: "Médecin", spec: "Angiologue" },
  ];

  const staff = await queryAll(DS.personnel);
  const byName = new Map(staff.map((p) => [title(p), p]));

  for (const p of staff) {
    const nom = title(p);
    if (ARCHIVE.includes(nom)) {
      await withRetry(() => notion.pages.update({ page_id: p.id, archived: true }));
      log(`Personnel: "${nom}" archivé (démo)`);
    } else if (KEEP[nom]) {
      const k = KEEP[nom];
      const props = {
        "Rôle": { select: { name: k.role } },
        "Actif": { checkbox: true },
      };
      if (k.spec) props["Spécialité"] = { select: { name: k.spec } };
      await withRetry(() => notion.pages.update({ page_id: p.id, properties: props }));
      log(`Personnel: "${nom}" mis à jour (${k.role}${k.spec ? " · " + k.spec : ""})`);
    } else {
      log(`Personnel: "${nom}" laissé tel quel (non reconnu)`);
    }
  }
  for (const c of CREATE) {
    if (byName.has(c.nom)) {
      log(`Personnel: "${c.nom}" existe déjà — ok`);
      continue;
    }
    await withRetry(() =>
      notion.pages.create({
        parent: { data_source_id: DS.personnel },
        properties: {
          "Nom": { title: [{ text: { content: c.nom } }] },
          "Rôle": { select: { name: c.role } },
          "Spécialité": { select: { name: c.spec } },
          "Actif": { checkbox: true },
        },
      })
    );
    log(`Personnel: "${c.nom}" créé (${c.role} · ${c.spec})`);
  }

  // ── 3. Parc d'appareils
  const FLEET = [
    ...[1, 2, 3, 4, 5].map((n) => ({ ref: `Holter rythmique n°${n}`, type: "Holter rythmique", num: String(n) })),
    { ref: "Holter tensionnel n°1", type: "Holter tensionnel", num: "1" },
    { ref: "Polygraphie n°1", type: "Polygraphie", num: "1" },
    { ref: "Polygraphie n°2", type: "Polygraphie", num: "2" },
    { ref: "Moniteur ECG n°1", type: "Moniteur ECG", num: "1" },
  ];
  const units = await queryAll(appareilsDataSourceId);
  const unitNames = new Set(units.map((p) => title(p, "Réf")));
  for (const u of FLEET) {
    if (unitNames.has(u.ref)) {
      log(`Appareils: "${u.ref}" existe déjà — ok`);
      continue;
    }
    await withRetry(() =>
      notion.pages.create({
        parent: { data_source_id: appareilsDataSourceId },
        properties: {
          "Réf": { title: [{ text: { content: u.ref } }] },
          "Type": { select: { name: u.type } },
          "Numéro": { rich_text: [{ text: { content: u.num } }] },
          "État": { select: { name: "Au cabinet" } },
        },
      })
    );
    log(`Appareils: "${u.ref}" créé`);
  }

  log("Terminé. Paramètres non touchés. Lancer le sync pour refléter dans Supabase.");
}

main().catch((e) => {
  console.error("[seed] ÉCHEC:", e?.body ?? e);
  process.exit(1);
});
