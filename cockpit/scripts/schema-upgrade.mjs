/**
 * Étape 1 du master plan : migration additive du schéma Notion.
 * - Crée la base ⭐ Appareils (inventaire physique des boîtiers)
 * - Ajoute les nouveaux champs sur Patients / Dossiers / Examens / Paiements / Personnel
 * - Étend les options des selects existants (Motif, Type de prestation)
 * Idempotent : re-runnable, ne touche jamais un champ déjà présent.
 *
 * Usage: node scripts/schema-upgrade.mjs
 */
import { notionClient, DS, withRetry } from "./notion-env.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(here, ".notion-appareils.json");
const notion = notionClient();

const log = (...a) => console.log("[schema]", ...a);

async function getProps(dataSourceId) {
  const ds = await withRetry(() => notion.dataSources.retrieve({ data_source_id: dataSourceId }));
  return ds;
}

async function addMissingProps(name, dataSourceId, wanted) {
  const ds = await getProps(dataSourceId);
  const existing = ds.properties ?? {};
  const toAdd = {};
  for (const [propName, schema] of Object.entries(wanted)) {
    if (existing[propName]) log(`${name}: "${propName}" existe déjà — ok`);
    else toAdd[propName] = schema;
  }
  if (Object.keys(toAdd).length === 0) return ds;
  await withRetry(() =>
    notion.dataSources.update({ data_source_id: dataSourceId, properties: toAdd })
  );
  log(`${name}: ajouté ${Object.keys(toAdd).map((p) => `"${p}"`).join(", ")}`);
  return getProps(dataSourceId);
}

/** Ajoute des options à un select existant sans perdre les options en place. */
async function extendSelect(name, dataSourceId, propName, newOptions) {
  const ds = await getProps(dataSourceId);
  const prop = ds.properties?.[propName];
  if (!prop || prop.type !== "select") {
    throw new Error(`${name}.${propName} introuvable ou pas un select`);
  }
  const current = prop.select.options ?? [];
  const missing = newOptions.filter((o) => !current.some((c) => c.name === o));
  if (missing.length === 0) {
    log(`${name}.${propName}: options déjà complètes — ok`);
    return;
  }
  await withRetry(() =>
    notion.dataSources.update({
      data_source_id: dataSourceId,
      properties: {
        [propName]: {
          select: { options: [...current.map((c) => ({ id: c.id, name: c.name, color: c.color })), ...missing.map((n) => ({ name: n }))] },
        },
      },
    })
  );
  log(`${name}.${propName}: options ajoutées ${missing.join(", ")}`);
}

const sel = (...names) => ({ select: { options: names.map((n) => ({ name: n })) } });

async function main() {
  // ── 1. Trouver la page parente du cockpit (parent de la base Examens)
  const examensDs = await getProps(DS.examens);
  const examensDbId = examensDs.parent?.database_id;
  if (!examensDbId) throw new Error("Parent database de Examens introuvable");
  const examensDb = await withRetry(() => notion.databases.retrieve({ database_id: examensDbId }));
  let parent = examensDb.parent;
  // Base inline : remonter la chaîne de blocs jusqu'à la page hôte.
  while (parent?.type === "block_id") {
    const block = await withRetry(() => notion.blocks.retrieve({ block_id: parent.block_id }));
    parent = block.parent;
  }
  const cockpitPageId = parent?.page_id;
  if (!cockpitPageId) throw new Error(`Page parente du cockpit introuvable (parent=${JSON.stringify(parent)})`);
  log("Page cockpit:", cockpitPageId);

  // ── 2. Créer la base Appareils (une fois)
  let state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
  if (!state.appareilsDataSourceId) {
    const db = await withRetry(() =>
      notion.databases.create({
        parent: { type: "page_id", page_id: cockpitPageId },
        title: [{ type: "text", text: { content: "Appareils" } }],
        initial_data_source: {
          properties: {
            "Réf": { title: {} },
            "Type": sel("Holter rythmique", "Holter tensionnel", "Polygraphie", "Moniteur ECG"),
            "Numéro": { rich_text: {} },
            "État": sel("Au cabinet", "Dehors", "Maintenance", "Perdu", "Réformé"),
            "Notes": { rich_text: {} },
            "Date d'achat": { date: {} },
          },
        },
      })
    );
    const dsId = db.data_sources?.[0]?.id;
    if (!dsId) throw new Error("data source id de Appareils introuvable après création");
    state = { appareilsDatabaseId: db.id, appareilsDataSourceId: dsId };
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    log("Base Appareils créée:", db.id, "data source:", dsId);
  } else {
    log("Base Appareils déjà créée:", state.appareilsDataSourceId);
  }

  // ── 3. Relation double Examens.Appareil ↔ Appareils."Examen en cours"
  const examensAfter = await getProps(DS.examens);
  if (!examensAfter.properties["Appareil"]) {
    await withRetry(() =>
      notion.dataSources.update({
        data_source_id: DS.examens,
        properties: {
          "Appareil": {
            relation: {
              data_source_id: state.appareilsDataSourceId,
              type: "dual_property",
              dual_property: {},
            },
          },
        },
      })
    );
    log("Examens: relation \"Appareil\" créée");
  } else log("Examens: relation \"Appareil\" existe déjà — ok");

  // Renommer la propriété synchronisée côté Appareils → "Examen en cours"
  const appareilsDs = await getProps(state.appareilsDataSourceId);
  const syncedEntry = Object.entries(appareilsDs.properties).find(
    ([n, p]) => p.type === "relation" && n !== "Examen en cours"
  );
  if (syncedEntry && !appareilsDs.properties["Examen en cours"]) {
    await withRetry(() =>
      notion.dataSources.update({
        data_source_id: state.appareilsDataSourceId,
        properties: { [syncedEntry[0]]: { name: "Examen en cours" } },
      })
    );
    log(`Appareils: "${syncedEntry[0]}" renommé en "Examen en cours"`);
  }

  // ── 4. Patients
  await addMissingProps("Patients", DS.patients, {
    "Date de naissance": { date: {} },
    "Adresse": { rich_text: {} },
    "Notes secrétariat": { rich_text: {} },
  });

  // ── 5. Dossiers
  await addMissingProps("Dossiers", DS.dossiers, {
    "Dossier parent": {
      relation: { data_source_id: DS.dossiers, type: "single_property", single_property: {} },
    },
    "Statut CR": sel("À rédiger", "À valider", "Envoyé"),
    "CR envoyé le": { date: {} },
    "Lien CR": { url: {} },
    "Ordonnance remise": { checkbox: {} },
  });
  await extendSelect("Dossiers", DS.dossiers, "Motif", [
    "Nutrition/surpoids",
    "Prévention",
    "Doppler vasculaire",
    "Avis chirurgical",
    "Perfusion",
    "Post-op",
  ]);

  // ── 6. Examens (volet appareillage / suivi SAS)
  await addMissingProps("Examens", DS.examens, {
    "CAT": sel("RAS", "Polysomnographie", "Mettre une PPC", "Refaire l'examen", "Autre"),
    "Contacté pour appareillage": { checkbox: {} },
    "Société d'appareillage": sel("Air+", "Autre"),
    "Appareillage posé le": { date: {} },
    "RDV suivi PGV": { date: {} },
    "RDV pneumologue": { date: {} },
  });

  // ── 7. Paiements : nouvelles prestations
  await extendSelect("Paiements", DS.paiements, "Type de prestation", [
    "Pénalité retard",
    "Perfusion nutrition",
  ]);

  // ── 8. Personnel : spécialité
  await addMissingProps("Personnel", DS.personnel, {
    "Spécialité": sel(
      "Cardiologue-rythmologue",
      "Cardiologue",
      "Nutrition",
      "Chirurgien cardiaque",
      "Chirurgien vasculaire",
      "Angiologue",
      "Pneumologue",
      "IPA",
      "Secrétaire"
    ),
  });

  log("Schéma Notion à jour. Data source Appareils:", state.appareilsDataSourceId);
}

main().catch((e) => {
  console.error("[schema] ÉCHEC:", e?.body ?? e);
  process.exit(1);
});
