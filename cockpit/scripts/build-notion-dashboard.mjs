/**
 * Ajoute aux pages de rôle des cartes-liens vers les nouvelles files (vues)
 * et vers l'inventaire Appareils, dans le style des cartes existantes
 * (callout + lien). L'API ne peut pas incruster une vue liée « live » ;
 * ces cartes ouvrent directement la bonne vue filtrée en un clic.
 * Idempotent : repère un marqueur et ne ré-ajoute pas.
 */
import { notionClient, DS, withRetry } from "./notion-env.mjs";

const notion = notionClient();
const APPAREILS_DB = "325da6c9-7b68-428a-a33f-fa1198751b1d";
const APPAREILS_DS = "b1163fb7-59b9-48d1-af6c-f6616cb06d90";
const PAGES = {
  home: "9c5c2daa-75c7-82b7-868a-816278e02a8a",
  medecin: "38ac2daa-75c7-81b4-b529-e98a51e91bf9",
  secretariat: "38ac2daa-75c7-8140-a9e5-f0ba52bced70",
};
// Ré-exécution : on repère la section par son titre plutôt qu'un marqueur visible.
const SECTION_TITLES = ["Appareils et files de suivi", "Files cliniques (comme l'app)", "Files secrétariat (comme l'app)"];
const nodash = (id) => id.replace(/-/g, "");
const dbUrl = (dbId) => `https://app.notion.com/p/${nodash(dbId)}`;
const viewUrl = (dbId, viewId) => `https://app.notion.com/p/${nodash(dbId)}?v=${nodash(viewId)}`;

async function children(id) {
  const o = []; let c;
  do { const r = await withRetry(() => notion.blocks.children.list({ block_id: id, page_size: 100, start_cursor: c })); o.push(...r.results); c = r.has_more ? r.next_cursor : undefined; } while (c);
  return o;
}
async function alreadyDone(pageId) {
  for (const b of await children(pageId)) {
    const rt = b[b.type]?.rich_text;
    const txt = Array.isArray(rt) ? rt.map((x) => x.plain_text).join("") : "";
    if (SECTION_TITLES.some((s) => txt.includes(s))) return true;
  }
  return false;
}
async function viewMap(dataSourceId) {
  const ds = await withRetry(() => notion.dataSources.retrieve({ data_source_id: dataSourceId }));
  const dbId = ds.parent.database_id;
  const res = await withRetry(() => notion.views.list({ database_id: dbId }));
  const m = new Map();
  for (const ref of res.results ?? []) {
    const v = await withRetry(() => notion.views.retrieve({ view_id: ref.id }));
    if (v.name) m.set(v.name, v.id);
  }
  return { dbId, m };
}

const heading = (text) => ({ heading_3: { rich_text: [{ text: { content: text } }] } });
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

async function append(pageId, blocks) {
  // Notion limite ~100 blocs/append ; nos lots sont petits.
  await withRetry(() => notion.blocks.children.append({ block_id: pageId, children: blocks }));
}

async function main() {
  const ex = await viewMap(DS.examens);
  const dos = await viewMap(DS.dossiers);
  const pay = await viewMap(DS.paiements);
  const app = await viewMap(APPAREILS_DS);

  // ---- HOME : section vue d'ensemble ----
  if (await alreadyDone(PAGES.home)) console.log("home: déjà fait");
  else {
    await append(PAGES.home, [
      { divider: {} },
      { heading_2: { rich_text: [{ text: { content: "Appareils et files de suivi" } }] } },
      { paragraph: { rich_text: [{ text: { content: "Les mêmes files que l'application web. Un clic ouvre la vue filtrée.", }, annotations: { color: "gray" } }] } },
      linkCard("📟", "Inventaire des appareils", dbUrl(APPAREILS_DB), "parc physique : au cabinet / dehors / en retard"),
      linkCard("🫁", "Suivi appareillage (apnée)", viewUrl(ex.dbId, ex.m.get("Suivi appareillage")), "polygraphies avec PPC à mettre en place"),
      linkCard("📄", "Comptes rendus à traiter", viewUrl(dos.dbId, dos.m.get("Comptes rendus à traiter")), "à rédiger ou à valider"),
      linkCard("⏰", "Appareils en retard", viewUrl(ex.dbId, ex.m.get("En retard")), "boîtiers non restitués à échéance"),
      linkCard("💶", "Paiements à relancer", viewUrl(pay.dbId, pay.m.get("À relancer")), "impayés et partiels"),
    ]);
    console.log("home: section ajoutée");
  }

  // ---- MÉDECIN : files cliniques ----
  if (await alreadyDone(PAGES.medecin)) console.log("medecin: déjà fait");
  else {
    await append(PAGES.medecin, [
      { divider: {} },
      heading("Files cliniques (comme l'app)"),
      linkCard("🔬", "À interpréter", viewUrl(ex.dbId, ex.m.get("À interpréter")), "appareils rendus, résultats à lire"),
      linkCard("📤", "À envoyer", viewUrl(ex.dbId, ex.m.get("À envoyer")), "comptes rendus interprétés à transmettre"),
      linkCard("🫁", "Suivi appareillage", viewUrl(ex.dbId, ex.m.get("Suivi appareillage")), "PPC à mettre en place puis RDV de suite"),
      linkCard("📄", "Comptes rendus à traiter", viewUrl(dos.dbId, dos.m.get("Comptes rendus à traiter")), "à rédiger ou à valider"),
    ]);
    console.log("medecin: section ajoutée");
  }

  // ---- SECRÉTARIAT : files secrétariat ----
  if (await alreadyDone(PAGES.secretariat)) console.log("secretariat: déjà fait");
  else {
    await append(PAGES.secretariat, [
      { divider: {} },
      heading("Files secrétariat (comme l'app)"),
      linkCard("✅", "Dossiers à vérifier", viewUrl(dos.dbId, dos.m.get("À vérifier (secrétariat)")), "à contrôler avant transmission au médecin"),
      linkCard("📟", "Inventaire des appareils", dbUrl(APPAREILS_DB), "au total / au cabinet / dehors / en retard"),
      linkCard("⌚", "Appareils dehors", viewUrl(ex.dbId, ex.m.get("Appareils dehors")), "remis, bientôt dus ou en retard"),
      linkCard("💶", "Paiements à relancer", viewUrl(pay.dbId, pay.m.get("À relancer")), "impayés et partiels"),
    ]);
    console.log("secretariat: section ajoutée");
  }

  console.log("\nTerminé.");
}
main().catch((e) => { console.error("ÉCHEC:", e?.body ?? e); process.exit(1); });
