import { notionClient, DS, withRetry } from "./notion-env.mjs";
const notion = notionClient();
const ds = await withRetry(() => notion.dataSources.retrieve({ data_source_id: DS.taches }));
if (ds.properties["Note"]) console.log("Note déjà présent.");
else {
  await withRetry(() => notion.dataSources.update({ data_source_id: DS.taches, properties: { "Note": { rich_text: {} } } }));
  console.log("Note ajouté à Tâches.");
}
