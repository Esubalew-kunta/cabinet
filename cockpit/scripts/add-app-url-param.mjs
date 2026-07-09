import { notionClient, DS, withRetry } from "./notion-env.mjs";
const notion = notionClient();
const props = (await withRetry(() => notion.dataSources.retrieve({ data_source_id: DS.parametres }))).properties;
const titleProp = Object.entries(props).find(([, v]) => v.type === "title")?.[0] || "Paramètre";
const valueProp = Object.entries(props).find(([k, v]) => v.type === "rich_text" && /valeur/i.test(k))?.[0]
  || Object.entries(props).find(([, v]) => v.type === "rich_text")?.[0] || "Valeur";
const q = await withRetry(() => notion.dataSources.query({ data_source_id: DS.parametres, filter: { property: titleProp, title: { equals: "app_url" } } }));
if (q.results.length) { console.log("app_url déjà présent."); }
else {
  await withRetry(() => notion.pages.create({
    parent: { type: "data_source_id", data_source_id: DS.parametres },
    properties: { [titleProp]: { title: [{ text: { content: "app_url" } }] }, [valueProp]: { rich_text: [{ text: { content: "" } }] } },
  }));
  console.log("Paramètre app_url créé (vide) — colle l'URL Render (https://…onrender.com) dans /admin.");
}
