import { notionClient, withRetry } from "./notion-env.mjs";
const notion = notionClient();

async function children(blockId) {
  const out = []; let cursor;
  do {
    const res = await withRetry(() => notion.blocks.children.list({ block_id: blockId, page_size: 100, start_cursor: cursor }));
    out.push(...res.results); cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}
const rt = (b) => { const t = b[b.type]; const r = t?.rich_text ?? t?.caption; return Array.isArray(r) ? r.map(x=>x.plain_text).join("") : ""; };

async function summarize(id, name, depth = 0) {
  const pad = "  ".repeat(depth);
  console.log(`${pad}===== ${name} [${id}] =====`);
  const blocks = await children(id);
  for (const b of blocks) {
    const t = b.type;
    if (t === "child_database") console.log(`${pad}  🗄️ inline DB: ${b.child_database.title}`);
    else if (t === "child_page") console.log(`${pad}  📄 subpage: ${b.child_page.title} [${b.id}]`);
    else if (t === "link_to_page") {
      const l = b.link_to_page; console.log(`${pad}  🔗 linked view/page → ${l.type}:${(l[l.type]||"").slice(0,8)}`);
    }
    else if (t.startsWith("heading")) console.log(`${pad}  ▸ ${rt(b)}`);
    else if (t === "callout") console.log(`${pad}  💬 ${rt(b).slice(0,64)}`);
    else if (t === "paragraph" && rt(b).trim()) console.log(`${pad}  ¶ ${rt(b).slice(0,64)}`);
    else if (t === "column_list") {
      for (const col of await children(b.id)) {
        for (const cb of await children(col.id)) {
          if (cb.type === "child_database") console.log(`${pad}    🗄️[col] ${cb.child_database.title}`);
          else if (cb.type === "link_to_page") console.log(`${pad}    🔗[col] ${cb.link_to_page.type}`);
          else if (cb.type.startsWith("heading")) console.log(`${pad}    ▸[col] ${rt(cb)}`);
          else if (cb.type === "callout") console.log(`${pad}    💬[col] ${rt(cb).slice(0,50)}`);
          else console.log(`${pad}    •[col] ${cb.type}`);
        }
      }
    }
    else console.log(`${pad}  • ${t}`);
  }
  console.log("");
}

async function main() {
  const res = await withRetry(() => notion.search({ filter: { property: "object", value: "page" }, page_size: 100 }));
  const want = ["Cockpit Dr Amraoui", "Accueil", "Secrétariat", "Médecin", "Administration"];
  const pages = {};
  for (const p of res.results) {
    let title = "";
    for (const v of Object.values(p.properties ?? {})) if (v.type === "title") { title = v.title?.map(t=>t.plain_text).join(""); break; }
    if (want.includes(title) && !pages[title]) pages[title] = p.id;
  }
  for (const name of want) {
    if (pages[name]) await summarize(pages[name], name);
    else console.log(`(page "${name}" introuvable)\n`);
  }
}
main().catch((e) => { console.error("ÉCHEC:", e?.body ?? e); process.exit(1); });
