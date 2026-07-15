/**
 * Tâches : ajoute « Catégorie » (select) et « Groupe récurrence » (rich_text).
 *
 * Catégorie      — demandée en réunion (juil. 2026) : Administration / Patient /
 *                  Mobilier / Paiement. Axe distinct de « Domaine », qui reste tel
 *                  quel (il porte la règle RLS des tâches Personnel de la Dre).
 * Groupe récurr. — relie les instances d'une tâche récurrente. Nécessaire à
 *                  l'idempotence : le cron (toutes les 2 h) doit pouvoir demander
 *                  « une instance ouverte de ce groupe existe-t-elle déjà ? »
 *                  avant d'en générer une, sinon il duplique.
 *
 * Idempotent : relançable sans risque.
 */
import { notionClient, DS, withRetry } from "./notion-env.mjs";

export const CATEGORIES = ["Administration", "Patient", "Mobilier", "Paiement"];

const notion = notionClient();
const ds = await withRetry(() => notion.dataSources.retrieve({ data_source_id: DS.taches }));

const patch = {};

if (ds.properties["Catégorie"]) {
  const existing = (ds.properties["Catégorie"].select?.options ?? []).map((o) => o.name);
  const missing = CATEGORIES.filter((c) => !existing.includes(c));
  if (missing.length === 0) {
    console.log(`Catégorie déjà présent (${existing.join(", ")}).`);
  } else {
    // Ne jamais réécrire la liste entière : on n'envoie que les manquantes,
    // sinon Notion supprimerait les options ajoutées à la main entre-temps.
    patch["Catégorie"] = {
      select: { options: [...existing.map((name) => ({ name })), ...missing.map((name) => ({ name }))] },
    };
    console.log(`Catégorie : ajout de ${missing.join(", ")}`);
  }
} else {
  patch["Catégorie"] = { select: { options: CATEGORIES.map((name) => ({ name })) } };
  console.log(`Catégorie : création (${CATEGORIES.join(", ")})`);
}

if (ds.properties["Groupe récurrence"]) {
  console.log("Groupe récurrence déjà présent.");
} else {
  patch["Groupe récurrence"] = { rich_text: {} };
  console.log("Groupe récurrence : création");
}

if (Object.keys(patch).length === 0) {
  console.log("Rien à faire.");
} else {
  await withRetry(() => notion.dataSources.update({ data_source_id: DS.taches, properties: patch }));
  const after = await withRetry(() => notion.dataSources.retrieve({ data_source_id: DS.taches }));
  console.log("--- vérification ---");
  console.log(
    "Catégorie:",
    (after.properties["Catégorie"]?.select?.options ?? []).map((o) => o.name).join(" | ") || "ABSENT"
  );
  console.log("Groupe récurrence:", after.properties["Groupe récurrence"]?.type ?? "ABSENT");
}
