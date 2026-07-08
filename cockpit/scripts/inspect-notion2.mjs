import { notionClient, DS, withRetry } from "./notion-env.mjs";
const notion = notionClient();
const DONNEES = "38ac2daa-75c7-8166-a954-cad5ed7e244c";

async function children(blockId) {
  const out = []; let cursor;
  do {
    const res = await withRetry(() => notion.blocks.children.list({ block_id: blockId, page_size: 100, start_cursor: cursor }));
    out.push(...res.results); cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}
const richText = (b) => { const t = b[b.type]; const rt = t?.rich_text ?? t?.caption; return Array.isArray(rt) ? rt : []; };

async function findNavLinks() {
  const links = new Map();
  const scan = async (id) => {
    for (const b of await children(id)) {
      for (const r of richText(b)) {
        if (r.type === "mention" && r.mention?.type === "page") links.set(r.plain_text, r.mention.page.id);
        if (r.href && r.href.startsWith("/")) links.set(r.plain_text, r.href.replace(/^\//, "").split("?")[0]);
      }
      if (b.type === "child_page") links.set("child:" + b.child_page.title, b.id);
      if (["column_list", "column", "toggle"].includes(b.type)) await scan(b.id);
    }
  };
  await scan(DONNEES);
  return links;
}

async function summarizePage(id, name) {
  console.log(`\n===== PAGE: ${name}  [${id}] =====`);
  try {
    const blocks = await children(id);
    for (const b of blocks) {
      const t = b.type;
      if (t === "child_database") console.log(`  🗄️ inline DB: ${b.child_database.title}`);
      else if (t.startsWith("heading")) console.log(`  ▸ ${richText(b).map(r=>r.plain_text).join("")}`);
      else if (t === "callout") console.log(`  💬 ${richText(b).map(r=>r.plain_text).join("").slice(0,70)}`);
      else if (t === "child_page") console.log(`  📄 subpage: ${b.child_page.title}`);
      else if (t === "link_to_page") console.log(`  🔗 link_to_page → ${JSON.stringify(b.link_to_page)}`);
      else if (t === "column_list") {
        for (const col of await children(b.id))
          for (const cb of await children(col.id)) {
            if (cb.type === "child_database") console.log(`    🗄️ [col] inline DB: ${cb.child_database.title}`);
            else if (cb.type === "link_to_page") console.log(`    🔗 [col] link_to_page → ${JSON.stringify(cb.link_to_page)}`);
            else if (cb.type.startsWith("heading")) console.log(`    ▸ [col] ${richText(cb).map(r=>r.plain_text).join("")}`);
            else console.log(`    • [col] ${cb.type}`);
          }
      }
      else console.log(`  • ${t}`);
    }
  } catch (e) { console.log("  (illisible: " + e.message + ")"); }
}

async function main() {
  const links = await findNavLinks();
  console.log("=== LIENS DE NAVIGATION TROUVÉS ===");
  for (const [k, v] of links) console.log(`  ${k} → ${v}`);

  // Inspecter chaque page liée (hors Données lui-même)
  for (const [name, id] of links) {
    if (id === DONNEES || name.includes("Données")) continue;
    await summarizePage(id, name);
  }

  // Dump brut d'une vue pour comprendre la forme
  console.log("\n\n=== FORME D'UNE VUE (dossiers) ===");
  const ds = await withRetry(() => notion.dataSources.retrieve({ data_source_id: DS.dossiers }));
  const views = await withRetry(() => notion.views.list({ database_id: ds.parent.database_id }));
  console.log(JSON.stringify(views.results?.map(v => ({ id: v.id, name: v.name, type: v.type, layout: v.layout })), null, 2));
}
main().catch((e) => { console.error("ÉCHEC:", e?.body ?? e); process.exit(1); });
