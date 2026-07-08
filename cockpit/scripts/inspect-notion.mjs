/**
 * Audit de l'état actuel du cockpit Notion : arbre des pages, blocs de chaque
 * page (vues de bases liées, texte), et vues de chaque base de données.
 * Lecture seule.
 */
import { notionClient, DS, withRetry } from "./notion-env.mjs";

const notion = notionClient();
const COCKPIT = "38ac2daa-75c7-8166-a954-cad5ed7e244c";

const dsName = Object.fromEntries(Object.entries(DS).map(([k, v]) => [v, k]));
dsName["b1163fb7-59b9-48d1-af6c-f6616cb06d90"] = "appareils";

async function children(blockId) {
  const out = [];
  let cursor;
  do {
    const res = await withRetry(() =>
      notion.blocks.children.list({ block_id: blockId, page_size: 100, start_cursor: cursor })
    );
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

function textOf(block) {
  const t = block[block.type];
  const rt = t?.rich_text ?? t?.caption;
  if (Array.isArray(rt)) return rt.map((r) => r.plain_text).join("");
  return "";
}

async function walk(blockId, depth, label) {
  const pad = "  ".repeat(depth);
  const blocks = await children(blockId);
  for (const b of blocks) {
    const type = b.type;
    if (type === "child_page") {
      console.log(`${pad}📄 PAGE: ${b.child_page.title}  [${b.id}]`);
      if (depth < 3) await walk(b.id, depth + 1);
    } else if (type === "child_database") {
      console.log(`${pad}🗄️  DB inline: ${b.child_database.title}  [${b.id}]`);
    } else if (type === "link_to_page") {
      const l = b.link_to_page;
      console.log(`${pad}🔗 link_to_page → ${l.type}:${l[l.type]}`);
    } else if (["heading_1", "heading_2", "heading_3"].includes(type)) {
      console.log(`${pad}▸ ${textOf(b)}`);
    } else if (type === "callout") {
      console.log(`${pad}💬 callout: ${textOf(b).slice(0, 60)}`);
    } else if (type === "paragraph") {
      const t = textOf(b);
      if (t.trim()) console.log(`${pad}  ¶ ${t.slice(0, 70)}`);
    } else if (type === "column_list" || type === "column") {
      await walk(b.id, depth, type);
    } else {
      console.log(`${pad}• ${type}`);
    }
  }
}

async function main() {
  console.log("=== ARBRE DES PAGES DU COCKPIT ===\n");
  const page = await withRetry(() => notion.pages.retrieve({ page_id: COCKPIT }));
  const title = page.properties?.title?.title?.map((t) => t.plain_text).join("") ?? "(cockpit)";
  console.log(`📄 ${title}  [${COCKPIT}]`);
  await walk(COCKPIT, 1);

  console.log("\n\n=== VUES PAR BASE DE DONNÉES ===\n");
  for (const [name, id] of Object.entries(DS)) {
    try {
      const ds = await withRetry(() => notion.dataSources.retrieve({ data_source_id: id }));
      const dbId = ds.parent?.database_id;
      const views = await withRetry(() => notion.views.list({ database_id: dbId }));
      const list = (views.results ?? []).map((v) => `${v.name ?? "(sans nom)"}[${v.type ?? v.layout ?? "?"}]`);
      console.log(`${name}: ${list.length} vue(s) → ${list.join(", ") || "—"}`);
    } catch (e) {
      console.log(`${name}: (vues illisibles: ${e.message})`);
    }
  }
  // Appareils
  try {
    const aId = "b1163fb7-59b9-48d1-af6c-f6616cb06d90";
    const ds = await withRetry(() => notion.dataSources.retrieve({ data_source_id: aId }));
    const views = await withRetry(() => notion.views.list({ database_id: ds.parent?.database_id }));
    const list = (views.results ?? []).map((v) => `${v.name ?? "(sans nom)"}[${v.type ?? v.layout ?? "?"}]`);
    console.log(`appareils: ${list.length} vue(s) → ${list.join(", ") || "—"}`);
  } catch (e) {
    console.log(`appareils: (vues illisibles: ${e.message})`);
  }
}

main().catch((e) => { console.error("ÉCHEC:", e?.body ?? e); process.exit(1); });
