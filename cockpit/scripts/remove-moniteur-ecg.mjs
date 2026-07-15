/**
 * Supprime « Moniteur ECG » partout (décision réunion juil. 2026).
 *
 * Vérifié avant écriture : 1 seule unité (« Moniteur ECG n°1 »), état « Au cabinet »,
 * AUCUN examen ne la référence, AUCUN examen de ce type → suppression sans perte d'historique.
 *
 * L'ORDRE COMPTE. Retirer une option d'un select Notion **vide silencieusement** le champ
 * sur les pages qui l'utilisaient (aucune erreur). On archive donc l'unité AVANT de retirer
 * l'option, sinon « Moniteur ECG n°1 » se retrouverait sans Type et disparaîtrait des vues
 * filtrées par Type.
 *
 * Refuse d'agir si la réalité ne correspond plus aux vérifications (unité prêtée,
 * examen lié…) : mieux vaut s'arrêter que casser des données.
 *
 * Idempotent.
 */
import { notionClient, DS, withRetry } from "./notion-env.mjs";

const CIBLE = "Moniteur ECG";
const notion = notionClient();
const dry = process.argv.includes("--dry-run");
const log = (s) => console.log(`${dry ? "[dry-run] " : ""}${s}`);

// ---------- 1. état des lieux ----------
const unites = await withRetry(() =>
  notion.dataSources.query({
    data_source_id: DS.appareils ?? "b1163fb7-59b9-48d1-af6c-f6616cb06d90",
    page_size: 100,
  })
);
const cibles = unites.results.filter((p) => p.properties["Type"]?.select?.name === CIBLE);
console.log(`Unités de type « ${CIBLE} » : ${cibles.length}`);

for (const u of cibles) {
  const ref = u.properties["Réf"]?.title?.[0]?.plain_text ?? "(sans réf)";
  const etat = u.properties["État"]?.select?.name ?? "(sans état)";
  const examens = u.properties["Examen en cours"]?.relation ?? [];
  console.log(`  · ${ref} — état=${etat}, examens liés=${examens.length}`);

  // Garde-fous : on ne supprime pas une unité en circulation.
  if (etat === "Dehors") {
    console.error(`✗ ARRÊT : « ${ref} » est Dehors (prêtée). Suppression annulée.`);
    process.exit(1);
  }
  if (examens.length > 0) {
    console.error(`✗ ARRÊT : « ${ref} » est liée à ${examens.length} examen(s). Suppression annulée.`);
    process.exit(1);
  }
}

// Aucun examen de ce type ?
const examens = await withRetry(() =>
  notion.dataSources.query({ data_source_id: DS.examens, page_size: 100 })
);
const examensCible = examens.results.filter((p) => p.properties["Type"]?.select?.name === CIBLE);
console.log(`Examens de type « ${CIBLE} » : ${examensCible.length}`);
if (examensCible.length > 0) {
  console.error(`✗ ARRÊT : ${examensCible.length} examen(s) de ce type existent. Suppression annulée.`);
  process.exit(1);
}

// ---------- 2. archiver les unités (AVANT de toucher aux options) ----------
for (const u of cibles) {
  const ref = u.properties["Réf"]?.title?.[0]?.plain_text ?? u.id;
  if (!dry) await withRetry(() => notion.pages.update({ page_id: u.id, archived: true }));
  log(`✓ unité archivée : ${ref}`);
}

// ---------- 3. retirer l'option des DEUX selects « Type » ----------
// « Moniteur ECG » vit sur deux bases indépendantes : Appareils ET Examens.
for (const [nom, dsId] of [
  ["Appareils", DS.appareils ?? "b1163fb7-59b9-48d1-af6c-f6616cb06d90"],
  ["Examens", DS.examens],
]) {
  const ds = await withRetry(() => notion.dataSources.retrieve({ data_source_id: dsId }));
  const prop = ds.properties["Type"];
  if (!prop?.select) {
    log(`· ${nom}.Type : absent ou non-select, ignoré`);
    continue;
  }
  const options = prop.select.options;
  if (!options.some((o) => o.name === CIBLE)) {
    log(`· ${nom}.Type : « ${CIBLE} » déjà absent`);
    continue;
  }
  // On renvoie la liste SANS la cible : Notion traite une liste d'options comme l'état voulu.
  const restantes = options.filter((o) => o.name !== CIBLE).map((o) => ({ id: o.id, name: o.name, color: o.color }));
  if (!dry) {
    await withRetry(() =>
      notion.dataSources.update({ data_source_id: dsId, properties: { Type: { select: { options: restantes } } } })
    );
  }
  log(`✓ ${nom}.Type : option retirée → ${restantes.map((o) => o.name).join(" | ")}`);
}

// ---------- 4. vérification ----------
if (!dry) {
  for (const [nom, dsId] of [
    ["Appareils", DS.appareils ?? "b1163fb7-59b9-48d1-af6c-f6616cb06d90"],
    ["Examens", DS.examens],
  ]) {
    const ds = await withRetry(() => notion.dataSources.retrieve({ data_source_id: dsId }));
    const noms = (ds.properties["Type"]?.select?.options ?? []).map((o) => o.name);
    console.log(`  ${nom}.Type = ${noms.join(" | ")} ${noms.includes(CIBLE) ? "✗ TOUJOURS PRÉSENT" : "✓"}`);
  }
}
console.log(dry ? "\n[dry-run] aucune écriture." : "\nTerminé. Pensez à retirer la ligne Supabase + TYPES_APPAREIL.");
