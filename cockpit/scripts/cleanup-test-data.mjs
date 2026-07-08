/**
 * Nettoyage des artefacts de test créés pendant la recette (patient Martin
 * Testeur, dossiers, examens, perfusion, paiements). Archive les pages Notion
 * correspondantes, remet toutes les unités à « Au cabinet », puis vide le
 * miroir Supabase des tables opérationnelles. Paramètres / Personnel / parc
 * Appareils : intouchés. Résultat = ardoise vierge pour la remise.
 *
 * Usage: node scripts/cleanup-test-data.mjs
 */
import { notionClient, DS, withRetry, loadEnv } from "./notion-env.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { appareilsDataSourceId } = JSON.parse(readFileSync(join(here, ".notion-appareils.json"), "utf8"));
loadEnv();
const notion = notionClient();
const log = (...a) => console.log("[cleanup]", ...a);

async function queryAll(dataSourceId) {
  const rows = [];
  let cursor;
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
  for (const r of rows) await withRetry(() => notion.pages.update({ page_id: r.id, archived: true }));
  log(`${name}: ${rows.length} page(s) archivée(s)`);
}

async function main() {
  // 1. Archiver les données opérationnelles de test
  for (const [name, id] of [
    ["Dossiers", DS.dossiers],
    ["Examens", DS.examens],
    ["Paiements", DS.paiements],
    ["Perfusions", DS.perfusions],
    ["Patients", DS.patients],
  ]) {
    await archiveAll(name, id);
  }

  // 2. Libérer toutes les unités (retour « Au cabinet »)
  const units = await queryAll(appareilsDataSourceId);
  let freed = 0;
  for (const u of units) {
    const etat = u.properties["État"]?.select?.name;
    if (etat && etat !== "Au cabinet") {
      await withRetry(() =>
        notion.pages.update({ page_id: u.id, properties: { "État": { select: { name: "Au cabinet" } } } })
      );
      freed++;
    }
  }
  log(`Appareils: ${freed} unité(s) remise(s) à « Au cabinet »`);

  // 3. Vider le miroir Supabase des tables opérationnelles
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: KEY, authorization: `Bearer ${KEY}`, Prefer: "return=minimal" };
  for (const t of ["patients", "dossiers", "taches", "examens", "paiements", "perfusions", "rapports", "taches_perso"]) {
    const r = await fetch(`${URL}/rest/v1/${t}?notion_id=neq.00000000-0000-0000-0000-000000000000`, {
      method: "DELETE",
      headers,
    });
    log(`miroir ${t}: ${r.status}`);
  }

  log("Ardoise vierge. Lancer un sync pour rafraîchir l'état des appareils dans le miroir.");
}

main().catch((e) => {
  console.error("[cleanup] ÉCHEC:", e?.body ?? e);
  process.exit(1);
});
