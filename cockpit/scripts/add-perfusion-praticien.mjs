/**
 * Nutrition — la part du médecin (demande de juil. 2026).
 *
 * « Pour la section nutrition : combien reverser au médecin qui a traité le patient, sur ce
 * que le patient a payé. »
 *
 * Il manquait le principal : une perfusion n'enregistrait PAS qui l'avait faite. Sans
 * praticien, aucune part n'est calculable. Ce script ajoute :
 *   1. Perfusions → « Praticien » (relation vers Personnel)
 *   2. Paramètres → « nutrition_part_medecin_pct » (le taux, en %)
 *
 * Idempotent : relancer ne crée pas de doublon.
 */
import { notionClient, DS, withRetry } from "./notion-env.mjs";

const notion = notionClient();

// ---------- 1. Perfusions."Praticien" → Personnel ----------

const perf = await withRetry(() => notion.dataSources.retrieve({ data_source_id: DS.perfusions }));
if (perf.properties["Praticien"]) {
  console.log('Perfusions: relation "Praticien" existe déjà — ok');
} else {
  await withRetry(() =>
    notion.dataSources.update({
      data_source_id: DS.perfusions,
      properties: {
        // single_property : Personnel n'a pas besoin d'une colonne retour « Perfusions ».
        Praticien: { relation: { data_source_id: DS.personnel, type: "single_property", single_property: {} } },
      },
    })
  );
  console.log('Perfusions: relation "Praticien" créée → Personnel');
}

// ---------- 2. Paramètres.nutrition_part_medecin_pct ----------

const params = (await withRetry(() => notion.dataSources.retrieve({ data_source_id: DS.parametres }))).properties;
const titleProp = Object.entries(params).find(([, v]) => v.type === "title")?.[0] || "Paramètre";
const valueProp =
  Object.entries(params).find(([k, v]) => v.type === "rich_text" && /valeur/i.test(k))?.[0] ||
  Object.entries(params).find(([, v]) => v.type === "rich_text")?.[0] ||
  "Valeur";

const NOM = "nutrition_part_medecin_pct";
const q = await withRetry(() =>
  notion.dataSources.query({ data_source_id: DS.parametres, filter: { property: titleProp, title: { equals: NOM } } })
);
if (q.results.length) {
  console.log(`Paramètre ${NOM} déjà présent — ok`);
} else {
  await withRetry(() =>
    notion.pages.create({
      parent: { type: "data_source_id", data_source_id: DS.parametres },
      properties: {
        [titleProp]: { title: [{ text: { content: NOM } }] },
        // 50 % : ordre de grandeur de l'existant (forfait 350-400 €, hono 150-200 €).
        // C'est un DÉFAUT, réglable dans /admin (l'éditeur en fait un compteur −/+).
        [valueProp]: { rich_text: [{ text: { content: "50" } }] },
      },
    })
  );
  console.log(`Paramètre ${NOM} créé (50) — réglable dans /admin.`);
}
