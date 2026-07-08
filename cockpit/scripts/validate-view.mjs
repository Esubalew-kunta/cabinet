import { notionClient, DS, withRetry } from "./notion-env.mjs";
const notion = notionClient();

async function main() {
  const ds = await withRetry(() => notion.dataSources.retrieve({ data_source_id: DS.examens }));
  const dbId = ds.parent.database_id;
  const props = ds.properties;
  const catId = props["CAT"]?.id;
  console.log("Examens db:", dbId, "| CAT prop id:", catId);

  // Tentative 1 : filtre par nom de propriété + select.equals
  const attempts = [
    {
      label: "property name + select.equals",
      filter: { property: "CAT", select: { equals: "Mettre une PPC" } },
    },
    {
      label: "property id + select.equals",
      filter: { property: catId, select: { equals: "Mettre une PPC" } },
    },
    {
      label: "and-wrapped",
      filter: { and: [{ property: catId, select: { equals: "Mettre une PPC" } }] },
    },
  ];

  for (const a of attempts) {
    try {
      const v = await withRetry(() =>
        notion.views.create({
          data_source_id: DS.examens,
          database_id: dbId,
          name: `TEST Suivi appareillage (${a.label})`,
          type: "table",
          filter: a.filter,
        })
      );
      const back = await withRetry(() => notion.views.retrieve({ view_id: v.id }));
      console.log(`\n[OK] "${a.label}" → view ${v.id}`);
      console.log("   filter returned:", JSON.stringify(back.filter));
      // nettoyer
      await withRetry(() => notion.views.delete({ view_id: v.id }));
      console.log("   (view supprimée)");
      if (back.filter) { console.log("\n>>> FILTRE ACCEPTÉ ET CONSERVÉ avec:", a.label); return; }
    } catch (e) {
      console.log(`\n[ÉCHEC] "${a.label}":`, e.body ? JSON.stringify(e.body).slice(0, 300) : e.message);
    }
  }
  console.log("\n>>> Aucune tentative n'a conservé le filtre. L'API ne permet pas d'écrire les filtres.");
}
main().catch((e) => { console.error("FATAL:", e?.body ?? e); process.exit(1); });
