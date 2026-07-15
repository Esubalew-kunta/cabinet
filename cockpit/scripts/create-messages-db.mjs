/**
 * Crée la base Notion « Messages équipe » (miroir du module Messages) et écrit
 * MESSAGES_NOTION_DS dans .env.local.
 *
 * Modèle repris des Horaires : Supabase est la source de vérité, Notion reçoit UNE
 * page par membre portant la transcription — assez pour que la Dre relise dans
 * Notion, sans en faire une seconde source de vérité.
 *
 * Idempotent : l'état est mémorisé dans scripts/.messages-state.json.
 * À lancer une fois ; sans lui le module marche (Supabase seul), le miroir est
 * simplement inactif.
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { notionClient, DS, withRetry } from "./notion-env.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(here, ".messages-state.json");
const ENV_FILE = join(here, "..", ".env.local");

const notion = notionClient();
const log = (...a) => console.log(...a);

// ── 1. Retrouver la page parente du cockpit (même parcours que create-horaires-db)
const examensDs = await withRetry(() => notion.dataSources.retrieve({ data_source_id: DS.examens }));
const examensDb = await withRetry(() => notion.databases.retrieve({ database_id: examensDs.parent?.database_id }));
let parent = examensDb.parent;
while (parent?.type === "block_id") {
  const block = await withRetry(() => notion.blocks.retrieve({ block_id: parent.block_id }));
  parent = block.parent;
}
const cockpitPageId = parent?.page_id;
if (!cockpitPageId) throw new Error(`Page parente du cockpit introuvable (parent=${JSON.stringify(parent)})`);

// ── 2. Créer la base (une fois)
let state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
if (!state.messagesDataSourceId) {
  const db = await withRetry(() =>
    notion.databases.create({
      parent: { type: "page_id", page_id: cockpitPageId },
      title: [{ type: "text", text: { content: "Messages équipe" } }],
      initial_data_source: {
        properties: {
          "Titre": { title: {} },
          "Membre": { rich_text: {} },
          "Derniers échanges": { rich_text: {} },
          "Nombre de messages": { number: { format: "number" } },
          "Mise à jour": { date: {} },
        },
      },
    })
  );
  const dsId = db.data_sources?.[0]?.id;
  state = { messagesDatabaseId: db.id, messagesDataSourceId: dsId };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  log("Base « Messages équipe » créée:", db.id, "data source:", dsId);
} else {
  log("Base « Messages équipe » déjà créée:", state.messagesDatabaseId);
}

// ── 3. Écrire MESSAGES_NOTION_DS dans .env.local (le drainer le lit)
const envRaw = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
if (/^MESSAGES_NOTION_DS=/m.test(envRaw)) {
  log("MESSAGES_NOTION_DS déjà présent dans .env.local.");
} else {
  appendFileSync(ENV_FILE, `${envRaw.endsWith("\n") || !envRaw ? "" : "\n"}MESSAGES_NOTION_DS=${state.messagesDataSourceId}\n`);
  log("MESSAGES_NOTION_DS ajouté à .env.local → redémarrer `next dev`.");
}

log("\nTerminé. Le miroir Notion se remplira à la prochaine sync (/api/sync, cron 2 h).");
