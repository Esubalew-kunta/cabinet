/*
 * create-horaires-db.mjs — module Horaires secrétariat (miroir Notion « grossier »).
 * Idempotent. Run:  node scripts/create-horaires-db.mjs
 *
 * Modèle A+B : Supabase reste la source de vérité ; Notion ne reçoit qu'UNE
 * page par secrétaire · semaine (résumé lisible), poussée en arrière-plan par
 * le drainer throttlé (/api/horaires-sync) → jamais de 429.
 *
 * Ce que fait le script (tout additif, ré-exécutable) :
 *   1. Trouve la page parente du cockpit (via la base Examens).
 *   2. Crée la base Notion "Horaires secrétariat" (une fois ; id caché dans
 *      .horaires-state.json) : Titre(title), Secrétaire, Semaine,
 *      Heures totales(number), Détail(rich_text), Mise à jour(date).
 *   3. Écrit HORAIRES_NOTION_DS=<data_source_id> dans .env.local (lu par le
 *      drainer). Redémarrer `next dev` après pour que l'env soit pris en compte.
 *   4. Sème 3 réglages dans Paramètres (heures d'ouverture + auto-édition
 *      secrétaire) pour l'éditeur /admin et la détection des trous.
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { notionClient, DS, withRetry } from "./notion-env.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const STATE_FILE = join(here, ".horaires-state.json");
const ENV_FILE = join(ROOT, ".env.local");

const notion = notionClient();
const log = (...a) => console.log(...a);
const sel = (...names) => ({ select: { options: names.map((name) => ({ name })) } });

async function getSource(dataSourceId) {
  return withRetry(() => notion.dataSources.retrieve({ data_source_id: dataSourceId }));
}

// ── 1. Page parente du cockpit (même parcours que schema-upgrade / abonnes)
const examensDs = await getSource(DS.examens);
const examensDbId = examensDs.parent?.database_id;
const examensDb = await withRetry(() => notion.databases.retrieve({ database_id: examensDbId }));
let parent = examensDb.parent;
while (parent?.type === "block_id") {
  const block = await withRetry(() => notion.blocks.retrieve({ block_id: parent.block_id }));
  parent = block.parent;
}
const cockpitPageId = parent?.page_id;
if (!cockpitPageId) throw new Error(`Page parente du cockpit introuvable (parent=${JSON.stringify(parent)})`);

// ── 2. Créer la base "Horaires secrétariat" (une fois)
let state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
if (!state.horairesDataSourceId) {
  const db = await withRetry(() =>
    notion.databases.create({
      parent: { type: "page_id", page_id: cockpitPageId },
      title: [{ type: "text", text: { content: "Horaires secrétariat" } }],
      initial_data_source: {
        properties: {
          "Titre": { title: {} },
          "Secrétaire": { rich_text: {} },
          "Semaine": { rich_text: {} },
          "Heures totales": { number: { format: "number" } },
          "Détail": { rich_text: {} },
          "Mise à jour": { date: {} },
        },
      },
    })
  );
  const dsId = db.data_sources?.[0]?.id;
  state = { horairesDatabaseId: db.id, horairesDataSourceId: dsId };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  log("Base « Horaires secrétariat » créée:", db.id, "data source:", dsId);
} else {
  log("Base « Horaires secrétariat » déjà créée:", state.horairesDatabaseId);
}

// ── 3. Écrire HORAIRES_NOTION_DS dans .env.local (le drainer le lit)
const envRaw = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
if (/^HORAIRES_NOTION_DS=/m.test(envRaw)) {
  log("HORAIRES_NOTION_DS déjà présent dans .env.local.");
} else {
  appendFileSync(ENV_FILE, `${envRaw.endsWith("\n") || !envRaw ? "" : "\n"}HORAIRES_NOTION_DS=${state.horairesDataSourceId}\n`);
  log("HORAIRES_NOTION_DS ajouté à .env.local → redémarrer `next dev`.");
}

// ── 4. Semer les réglages dans Paramètres (éditeur /admin + détection des trous)
const paramProps = (await getSource(DS.parametres)).properties;
const titleProp = Object.entries(paramProps).find(([, v]) => v.type === "title")?.[0] || "Paramètre";
const valueProp =
  Object.entries(paramProps).find(([k, v]) => v.type === "rich_text" && /valeur/i.test(k))?.[0] ||
  Object.entries(paramProps).find(([, v]) => v.type === "rich_text")?.[0] ||
  "Valeur";
const descProp = Object.entries(paramProps).find(([k, v]) => v.type === "rich_text" && /description/i.test(k))?.[0] || null;

const SETTINGS_SEED = [
  ["operating_hours_start", "08:00", "Heure d'ouverture du cabinet (détection des heures non couvertes)."],
  ["operating_hours_end", "19:00", "Heure de fermeture du cabinet (détection des heures non couvertes)."],
  ["secretary_self_edit", "on", "on = les secrétaires modifient leurs propres horaires ; off = médecin seule."],
];

for (const [name, value, desc] of SETTINGS_SEED) {
  const existing = await withRetry(() =>
    notion.dataSources.query({
      data_source_id: DS.parametres,
      filter: { property: titleProp, title: { equals: name } },
    })
  );
  if (existing.results.length === 0) {
    const props = {
      [titleProp]: { title: [{ text: { content: name } }] },
      [valueProp]: { rich_text: [{ text: { content: value } }] },
    };
    if (descProp) props[descProp] = { rich_text: [{ text: { content: desc } }] };
    await withRetry(() =>
      notion.pages.create({ parent: { type: "data_source_id", data_source_id: DS.parametres }, properties: props })
    );
    log(`Paramètre « ${name} » créé (= ${value}).`);
  } else {
    log(`Paramètre « ${name} » déjà présent.`);
  }
}

log("\nData source Horaires:", state.horairesDataSourceId);
log("Prochaine étape: `node scripts/run-sql.mjs supabase/migrations/010_horaires.sql` (déjà fait), puis lancer une sync pour mirroir les nouveaux Paramètres.");
