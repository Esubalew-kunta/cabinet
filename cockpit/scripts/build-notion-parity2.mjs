/**
 * Parité Notion ↔ web app pour Tâches & Inventaire (plan 8 juil.) :
 * 1. Vues Tâches : « En retard » (échéance passée, non terminé) +
 *    « Par personne » (board par Responsable) — le pendant du /taches upgradé.
 * 2. Vues Inventaire : « Stock bas » (formule Alerte ≠ OK) + « Par catégorie ».
 * 3. Vue Mouvements : « Journal » (tri par date desc).
 * 4. Cartes-liens sur les tableaux de bord (home + secrétariat) vers ces vues.
 * 5. Section Inventaire dans la page Guide.
 * Idempotent partout.
 */
import { notionClient, DS, withRetry } from "./notion-env.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const inv = JSON.parse(readFileSync(join(here, ".notion-inventaire.json"), "utf8"));
const notion = notionClient();
const log = (...a) => console.log("[parity2]", ...a);

const PAGES = {
  home: "9c5c2daa-75c7-82b7-868a-816278e02a8a",
  secretariat: "38ac2daa-75c7-8140-a9e5-f0ba52bced70",
  guide: "397c2daa-75c7-813d-8e57-cba162ac5618",
};
const nodash = (id) => id.replace(/-/g, "");
const viewUrl = (dbId, viewId) => `https://app.notion.com/p/${nodash(dbId)}?v=${nodash(viewId)}`;

async function dsInfo(dataSourceId) {
  const ds = await withRetry(() => notion.dataSources.retrieve({ data_source_id: dataSourceId }));
  const propId = {};
  for (const [name, p] of Object.entries(ds.properties)) propId[name] = p.id;
  return { dbId: ds.parent.database_id, propId };
}
async function existingViews(dbId) {
  const res = await withRetry(() => notion.views.list({ database_id: dbId }));
  const m = new Map();
  for (const ref of res.results ?? []) {
    const v = await withRetry(() => notion.views.retrieve({ view_id: ref.id }));
    if (v.name) m.set(v.name, v.id);
  }
  return m;
}
async function ensureView(dataSourceId, dbId, existing, spec) {
  if (existing.has(spec.name)) { log(`= vue "${spec.name}" existe`); return existing.get(spec.name); }
  const body = { data_source_id: dataSourceId, database_id: dbId, name: spec.name, type: spec.type ?? "table" };
  if (spec.filter) body.filter = spec.filter;
  if (spec.sorts) body.sorts = spec.sorts;
  if (spec.configuration) body.configuration = spec.configuration;
  const v = await withRetry(() => notion.views.create(body));
  existing.set(spec.name, v.id);
  log(`+ vue "${spec.name}" créée`);
  return v.id;
}

async function children(id) {
  const o = []; let c;
  do { const r = await withRetry(() => notion.blocks.children.list({ block_id: id, page_size: 100, start_cursor: c })); o.push(...r.results); c = r.has_more ? r.next_cursor : undefined; } while (c);
  return o;
}
async function pageHasText(pageId, needle) {
  for (const b of await children(pageId)) {
    const rt = b[b.type]?.rich_text;
    const txt = Array.isArray(rt) ? rt.map((x) => x.plain_text).join("") : "";
    if (txt.includes(needle)) return true;
  }
  return false;
}
const rt = (content, opts = {}) => ({ text: { content }, annotations: opts });
const linkCard = (emoji, label, url, note) => ({
  callout: {
    icon: { emoji },
    color: "gray_background",
    rich_text: [
      { text: { content: label, link: { url } }, annotations: { bold: true } },
      ...(note ? [{ text: { content: "  —  " + note }, annotations: { color: "gray" } }] : []),
    ],
  },
});

async function main() {
  // ---------- 1. Vues Tâches ----------
  const t = await dsInfo(DS.taches);
  const tViews = await existingViews(t.dbId);
  log("Tâches:");
  const vRetard = await ensureView(DS.taches, t.dbId, tViews, {
    name: "En retard",
    filter: {
      and: [
        { property: "Échéance", date: { before: "today" } },
        { property: "Statut", select: { does_not_equal: "Terminé" } },
      ],
    },
  });
  await ensureView(DS.taches, t.dbId, tViews, {
    name: "Par personne",
    type: "board",
    filter: { property: "Statut", select: { does_not_equal: "Terminé" } },
    configuration: {
      type: "board",
      group_by: { type: "relation", property_id: t.propId["Responsable"], sort: { type: "manual" } },
    },
  });

  // ---------- 2. Vues Inventaire ----------
  const invInfo = await dsInfo(inv.inventaireDataSourceId);
  const iViews = await existingViews(invInfo.dbId);
  log("Inventaire:");
  let vBas;
  if (iViews.has("Stock bas")) {
    vBas = iViews.get("Stock bas");
    log('= vue "Stock bas" existe');
  } else {
    // Le type de la formule Alerte n'est matérialisé qu'après une première
    // évaluation : on crée une ligne temporaire, puis on filtre dessus.
    let temp = null;
    try {
      temp = await withRetry(() =>
        notion.pages.create({
          parent: { data_source_id: inv.inventaireDataSourceId },
          properties: {
            Article: { title: [{ text: { content: "TEMP typage formule" } }] },
            "Quantité": { number: 1 },
            "Seuil minimum": { number: 0 },
          },
        })
      );
      vBas = await ensureView(inv.inventaireDataSourceId, invInfo.dbId, iViews, {
        name: "Stock bas",
        filter: {
          or: [
            { property: "Alerte", formula: { string: { equals: "Bas" } } },
            { property: "Alerte", formula: { string: { equals: "Rupture" } } },
          ],
        },
      });
    } catch (e) {
      log("(filtre formule refusé — repli : vue triée par quantité)", e.body?.message ?? e.message);
      vBas = await ensureView(inv.inventaireDataSourceId, invInfo.dbId, iViews, {
        name: "Stock bas",
        sorts: [{ property: "Quantité", direction: "ascending" }],
      });
    } finally {
      if (temp) await withRetry(() => notion.pages.update({ page_id: temp.id, archived: true }));
    }
  }
  await ensureView(inv.inventaireDataSourceId, invInfo.dbId, iViews, {
    name: "Par catégorie",
    type: "board",
    configuration: {
      type: "board",
      group_by: { type: "select", property_id: invInfo.propId["Catégorie"], sort: { type: "manual" } },
    },
  });

  // ---------- 3. Vue Mouvements ----------
  const mvInfo = await dsInfo(inv.mouvementsDataSourceId);
  const mViews = await existingViews(mvInfo.dbId);
  log("Mouvements:");
  await ensureView(inv.mouvementsDataSourceId, mvInfo.dbId, mViews, {
    name: "Journal",
    sorts: [{ property: "Date", direction: "descending" }],
  });

  // ---------- 4. Cartes sur les tableaux de bord ----------
  const cards = [
    linkCard("📦", "Inventaire — stock bas", viewUrl(invInfo.dbId, vBas), "consommables à réapprovisionner"),
    linkCard("⏰", "Tâches en retard", viewUrl(t.dbId, vRetard), "échéance passée, pas encore faites"),
  ];
  for (const [name, pageId] of [["home", PAGES.home], ["secretariat", PAGES.secretariat]]) {
    if (await pageHasText(pageId, "Inventaire — stock bas")) { log(`${name}: cartes déjà présentes`); continue; }
    await withRetry(() => notion.blocks.children.append({ block_id: pageId, children: cards }));
    log(`${name}: cartes ajoutées`);
  }

  // ---------- 5. Guide : section Inventaire + pool de tâches ----------
  if (await pageHasText(PAGES.guide, "Inventaire (consommables)")) {
    log("guide: section déjà présente");
  } else {
    await withRetry(() =>
      notion.blocks.children.append({
        block_id: PAGES.guide,
        children: [
          { divider: {} },
          { heading_2: { rich_text: [rt("📦 Inventaire (consommables)")] } },
          { bulleted_list_item: { rich_text: [rt("Chaque article a une quantité et un seuil minimum — au seuil ou en dessous, il passe « Bas » et apparaît dans la bannière à réapprovisionner.")] } },
          { bulleted_list_item: { rich_text: [rt("Réappro = entrée (+), Sortie = utilisation (−). Chaque mouvement est tracé : qui, quand, combien, pourquoi.")] } },
          { bulleted_list_item: { rich_text: [rt("Ajouter un nouvel article est réservé à l'administration ; le réappro et les sorties sont faits par le secrétariat.")] } },
          { divider: {} },
          { heading_2: { rich_text: [rt("✅ Tâches — qui fait quoi")] } },
          { bulleted_list_item: { rich_text: [rt("Chaque nouveau dossier crée automatiquement une tâche « Prendre en charge — patient » assignée à la Dre par défaut.")] } },
          { bulleted_list_item: { rich_text: [rt("Une tâche peut être réassignée à n'importe qui : médecins, IPA (Rita, traitée comme un médecin) et secrétaires.")] } },
          { bulleted_list_item: { rich_text: [rt("La vue « En retard » montre ce qui a dépassé son échéance sans être fait — à vider chaque jour.")] } },
        ],
      })
    );
    log("guide: section ajoutée");
  }

  log("Terminé.");
}
main().catch((e) => { console.error("[parity2] ÉCHEC:", e?.body ?? e); process.exit(1); });
