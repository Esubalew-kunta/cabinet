import { notionClient, DS, withRetry } from "./notion-env.mjs";
const notion = notionClient();

async function main() {
  console.log("=== RECHERCHE DE PAGES (workspace visible par l'intégration) ===");
  const res = await withRetry(() => notion.search({ filter: { property: "object", value: "page" }, page_size: 100 }));
  for (const p of res.results) {
    let title = "(sans titre)";
    const props = p.properties ?? {};
    for (const v of Object.values(props)) {
      if (v.type === "title") { title = v.title?.map((t) => t.plain_text).join("") || title; break; }
    }
    const parent = p.parent?.type === "page_id" ? `page:${p.parent.page_id.slice(0,8)}` :
      p.parent?.type === "data_source_id" ? `ds` : p.parent?.type;
    console.log(`  📄 ${title}  [${p.id.slice(0,8)}] parent=${parent}`);
  }

  console.log("\n=== DÉTAIL D'UNE VUE (retrieve) ===");
  try {
    const v = await withRetry(() => notion.views.retrieve({ view_id: "391c2daa-75c7-8174-8286-000cec361f1f" }));
    console.log(JSON.stringify(v, null, 2).slice(0, 1500));
  } catch (e) { console.log("(retrieve view failed: " + e.message + ")"); }
}
main().catch((e) => { console.error("ÉCHEC:", e?.body ?? e); process.exit(1); });
