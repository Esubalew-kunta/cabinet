/*
 * add-split-names.mjs — split names into Prénom + Nom de famille.
 * Idempotent. Adds two rich_text fields to Patients + Personnel and backfills
 * them from the existing full-name title. The title ("Nom") stays the FULL
 * name (composed), so rollups/emails/displays keep working.
 *
 *   node scripts/add-split-names.mjs
 */
import { notionClient, DS, withRetry } from "./notion-env.mjs";

const notion = notionClient();
const log = (...a) => console.log(...a);

const HONORIFICS = /^(dr|dre|pr|prof|m|mme|mlle|mr)\.?\s+/i;

// "Dr Leslie Berdah Sadaoui" -> { prenom: "Leslie", nom: "Berdah Sadaoui" }
function split(full) {
  const clean = String(full || "").trim().replace(HONORIFICS, "").trim();
  if (!clean) return { prenom: "", nom: "" };
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return { prenom: parts[0], nom: "" };
  return { prenom: parts[0], nom: parts.slice(1).join(" ") };
}

async function ensureFields(dataSourceId, label) {
  const ds = await withRetry(() => notion.dataSources.retrieve({ data_source_id: dataSourceId }));
  const has = (n) => Boolean(ds.properties[n]);
  const toAdd = {};
  if (!has("Prénom")) toAdd["Prénom"] = { rich_text: {} };
  if (!has("Nom de famille")) toAdd["Nom de famille"] = { rich_text: {} };
  if (Object.keys(toAdd).length) {
    await withRetry(() => notion.dataSources.update({ data_source_id: dataSourceId, properties: toAdd }));
    log(`${label}: champs ajoutés →`, Object.keys(toAdd).join(", "));
  } else {
    log(`${label}: champs déjà présents.`);
  }
}

async function backfill(dataSourceId, label) {
  let cursor;
  let done = 0, skipped = 0;
  do {
    const res = await withRetry(() =>
      notion.dataSources.query({ data_source_id: dataSourceId, page_size: 100, start_cursor: cursor })
    );
    for (const page of res.results) {
      const p = page.properties || {};
      const full = p["Nom"]?.title?.[0]?.plain_text || "";
      const curPrenom = p["Prénom"]?.rich_text?.[0]?.plain_text || "";
      const curNom = p["Nom de famille"]?.rich_text?.[0]?.plain_text || "";
      if (curPrenom || curNom) { skipped++; continue; }   // déjà rempli
      const { prenom, nom } = split(full);
      if (!prenom && !nom) { skipped++; continue; }
      await withRetry(() =>
        notion.pages.update({
          page_id: page.id,
          properties: {
            "Prénom": { rich_text: prenom ? [{ text: { content: prenom } }] : [] },
            "Nom de famille": { rich_text: nom ? [{ text: { content: nom } }] : [] },
          },
        })
      );
      done++;
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  log(`${label}: backfill → ${done} mis à jour, ${skipped} inchangés.`);
}

for (const [dsId, label] of [[DS.patients, "Patients"], [DS.personnel, "Personnel"]]) {
  await ensureFields(dsId, label);
  await backfill(dsId, label);
}
log("Terminé.");
