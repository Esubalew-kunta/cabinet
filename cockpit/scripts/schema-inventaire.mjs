/**
 * Inventaire (consommables) : crée les deux bases Notion du module stock.
 * - Inventaire : une ligne = un article (quantité, seuil minimum, fournisseur…)
 * - Mouvements stock : une ligne = une entrée/sortie (journal auditable)
 * Relation double Mouvements.Article ↔ Inventaire.Mouvements + formule Alerte
 * (Bas/OK) pour que Notion puisse filtrer le stock bas comme l'app.
 * Idempotent (état dans scripts/.notion-inventaire.json).
 *
 * Usage: node scripts/schema-inventaire.mjs
 */
import { notionClient, DS, withRetry } from "./notion-env.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(here, ".notion-inventaire.json");
const COCKPIT_PAGE = "38ac2daa-75c7-8166-a954-cad5ed7e244c"; // page Données
const notion = notionClient();
const log = (...a) => console.log("[inventaire]", ...a);

const sel = (...names) => ({ select: { options: names.map((n) => ({ name: n })) } });

async function main() {
  let state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};

  // ── 1. Base Inventaire
  if (!state.inventaireDataSourceId) {
    const db = await withRetry(() =>
      notion.databases.create({
        parent: { type: "page_id", page_id: COCKPIT_PAGE },
        title: [{ type: "text", text: { content: "Inventaire" } }],
        initial_data_source: {
          properties: {
            "Article": { title: {} },
            "Catégorie": sel("Consommable", "Fourniture", "Pièce appareil", "Autre"),
            "Quantité": { number: {} },
            "Unité": sel("pièces", "boîtes", "ml", "paires"),
            "Seuil minimum": { number: {} },
            "Fournisseur": { rich_text: {} },
            "Dernier réappro": { date: {} },
            "Notes": { rich_text: {} },
          },
        },
      })
    );
    state.inventaireDatabaseId = db.id;
    state.inventaireDataSourceId = db.data_sources?.[0]?.id;
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    log("Base Inventaire créée:", db.id, "ds:", state.inventaireDataSourceId);
  } else log("Base Inventaire déjà créée:", state.inventaireDataSourceId);

  // ── 2. Formule Alerte (permet à Notion de filtrer « stock bas » comme l'app)
  try {
    const ds = await withRetry(() => notion.dataSources.retrieve({ data_source_id: state.inventaireDataSourceId }));
    if (!ds.properties["Alerte"]) {
      await withRetry(() =>
        notion.dataSources.update({
          data_source_id: state.inventaireDataSourceId,
          properties: {
            "Alerte": {
              formula: {
                expression:
                  'if(prop("Quantité") == 0, "Rupture", if(prop("Quantité") <= prop("Seuil minimum"), "Bas", "OK"))',
              },
            },
          },
        })
      );
      log('Formule "Alerte" ajoutée (Rupture / Bas / OK)');
    } else log('Formule "Alerte" existe déjà');
  } catch (e) {
    log("(formule Alerte non créée — filtrage stock bas côté app uniquement)", e.body?.message ?? e.message);
  }

  // ── 3. Base Mouvements stock
  if (!state.mouvementsDataSourceId) {
    const db = await withRetry(() =>
      notion.databases.create({
        parent: { type: "page_id", page_id: COCKPIT_PAGE },
        title: [{ type: "text", text: { content: "Mouvements stock" } }],
        initial_data_source: {
          properties: {
            "Réf": { title: {} },
            "Sens": sel("Entrée", "Sortie"),
            "Quantité": { number: {} },
            "Motif": { rich_text: {} },
            "Date": { date: {} },
          },
        },
      })
    );
    state.mouvementsDatabaseId = db.id;
    state.mouvementsDataSourceId = db.data_sources?.[0]?.id;
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    log("Base Mouvements stock créée:", db.id, "ds:", state.mouvementsDataSourceId);
  } else log("Base Mouvements déjà créée:", state.mouvementsDataSourceId);

  // ── 4. Relations : Mouvements.Article ↔ Inventaire (double, historique visible
  //      côté article) + Mouvements.Par → Personnel (simple)
  const mvDs = await withRetry(() => notion.dataSources.retrieve({ data_source_id: state.mouvementsDataSourceId }));
  if (!mvDs.properties["Article"]) {
    await withRetry(() =>
      notion.dataSources.update({
        data_source_id: state.mouvementsDataSourceId,
        properties: {
          "Article": {
            relation: { data_source_id: state.inventaireDataSourceId, type: "dual_property", dual_property: {} },
          },
        },
      })
    );
    log('Relation "Article" créée (double)');
    // renomme la propriété synchronisée côté Inventaire → "Mouvements"
    const invDs = await withRetry(() => notion.dataSources.retrieve({ data_source_id: state.inventaireDataSourceId }));
    const synced = Object.entries(invDs.properties).find(([n, p]) => p.type === "relation" && n !== "Mouvements");
    if (synced && !invDs.properties["Mouvements"]) {
      await withRetry(() =>
        notion.dataSources.update({
          data_source_id: state.inventaireDataSourceId,
          properties: { [synced[0]]: { name: "Mouvements" } },
        })
      );
      log(`Inventaire: "${synced[0]}" renommé en "Mouvements"`);
    }
  } else log('Relation "Article" existe déjà');

  if (!mvDs.properties["Par"]) {
    await withRetry(() =>
      notion.dataSources.update({
        data_source_id: state.mouvementsDataSourceId,
        properties: {
          "Par": { relation: { data_source_id: DS.personnel, type: "single_property", single_property: {} } },
        },
      })
    );
    log('Relation "Par" → Personnel créée');
  } else log('Relation "Par" existe déjà');

  log("Terminé.");
  log("inventaire ds:", state.inventaireDataSourceId);
  log("mouvements ds:", state.mouvementsDataSourceId);
}

main().catch((e) => { console.error("[inventaire] ÉCHEC:", e?.body ?? e); process.exit(1); });
