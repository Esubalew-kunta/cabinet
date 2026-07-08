/**
 * Vérifie que les références des instructions de l'assistant (v4) collent
 * encore au cockpit actuel : bases de tâches, champs attendus, fiches
 * propriétaire/secrétaire, équipe réelle. Lecture seule.
 */
import { notionClient, withRetry } from "./notion-env.mjs";
const notion = notionClient();

const TACHES_PERSO = "840fa987-9a85-4bc8-b17c-5f9cf39f06f5";
const TACHES_CABINET = "66303da0-61e8-40a5-adfc-0b63ab7c2c14";
const PERSONNEL = "2895672b-5349-4ac6-a505-a6aad98c3495";
const OWNER = "38ac2daa-75c7-8121-9972-d2a73c40faf0"; // Dr Amraoui (v4: 38ac2daa75c781219972d2a73c40faf0)
const SECRETARY = "38ec2daa-75c7-8142-bc31-f8cb15338195"; // Secrétaire cabinet 1

const ok = (b) => (b ? "✅" : "❌ MANQUANT");

async function fields(dsId) {
  const ds = await withRetry(() => notion.dataSources.retrieve({ data_source_id: dsId }));
  const map = {};
  for (const [name, p] of Object.entries(ds.properties)) map[name] = p.type;
  return map;
}
const has = (map, names) => names.map((n) => `   ${ok(map[n] !== undefined)} ${n}${map[n] ? " (" + map[n] + ")" : ""}`).join("\n");

async function main() {
  console.log("=== TÂCHES PERSONNELLES (privé) ===");
  const perso = await fields(TACHES_PERSO);
  console.log(has(perso, ["Titre", "Statut", "Priorité", "Domaine", "Échéance", "Calendrier", "Récurrence", "Événement agenda", "Note de clôture"]));

  console.log("\n=== TÂCHES CABINET (partagé) ===");
  const cab = await fields(TACHES_CABINET);
  console.log(has(cab, ["Titre", "Statut", "Priorité", "Domaine", "Échéance", "Calendrier", "Récurrence", "Événement agenda", "Note de clôture", "Responsable", "Notifier", "Notifié le", "Patient lié", "Dossier lié"]));

  console.log("\n=== FICHES CLÉS ===");
  for (const [label, id] of [["Propriétaire Dr Amraoui", OWNER], ["Secrétaire principale", SECRETARY]]) {
    try {
      const pg = await withRetry(() => notion.pages.retrieve({ page_id: id }));
      const title = Object.values(pg.properties).find((v) => v.type === "title")?.title?.map((t) => t.plain_text).join("");
      console.log(`   ✅ ${label} → "${title}" (archivé: ${pg.archived})`);
    } catch (e) { console.log(`   ❌ ${label} [${id}] introuvable: ${e.message}`); }
  }

  console.log("\n=== ÉQUIPE RÉELLE (lookup vivant de l'assistant) ===");
  const staff = await withRetry(() => notion.dataSources.query({ data_source_id: PERSONNEL, page_size: 100 }));
  for (const p of staff.results) {
    const nom = p.properties["Nom"]?.title?.map((t) => t.plain_text).join("") ?? "";
    const role = p.properties["Rôle"]?.select?.name ?? "";
    const spec = p.properties["Spécialité"]?.select?.name ?? "";
    const email = p.properties["Email"]?.email ?? "—";
    console.log(`   • ${nom}  [${role}${spec ? " · " + spec : ""}]  ${email}`);
  }
}
main().catch((e) => { console.error("ÉCHEC:", e?.body ?? e); process.exit(1); });
