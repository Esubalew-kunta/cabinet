/*
 * add-exam-conclusion.mjs — add a "Conclusion" select to Examens (every exam
 * type gets a clear outcome). Idempotent.
 *   node scripts/add-exam-conclusion.mjs
 */
import { notionClient, DS, withRetry } from "./notion-env.mjs";

const notion = notionClient();
const ds = await withRetry(() => notion.dataSources.retrieve({ data_source_id: DS.examens }));
if (ds.properties["Conclusion"]) {
  console.log("Conclusion déjà présent.");
} else {
  await withRetry(() =>
    notion.dataSources.update({
      data_source_id: DS.examens,
      properties: {
        "Conclusion": { select: { options: [
          { name: "Normal" }, { name: "Anormal" }, { name: "À revoir" }, { name: "Incomplet" },
        ] } },
      },
    })
  );
  console.log("Conclusion ajouté à Examens.");
}
