/**
 * Rend le cockpit Notion conforme au web app : crée sur chaque base les vues
 * filtrées qui reproduisent les écrans/queues de l'application.
 * Idempotent : une vue portant déjà ce nom n'est pas recréée.
 * Additif et sans risque (n8n et le sync lisent les bases, pas les vues).
 */
import { notionClient, DS, withRetry } from "./notion-env.mjs";

const notion = notionClient();
const APPAREILS_DS = "b1163fb7-59b9-48d1-af6c-f6616cb06d90";

async function dsInfo(dataSourceId) {
  const ds = await withRetry(() => notion.dataSources.retrieve({ data_source_id: dataSourceId }));
  const propId = {};
  for (const [name, p] of Object.entries(ds.properties)) propId[name] = p.id;
  return { dbId: ds.parent.database_id, propId };
}

async function existingViewNames(dbId) {
  const res = await withRetry(() => notion.views.list({ database_id: dbId }));
  const names = new Map();
  for (const ref of res.results ?? []) {
    try {
      const v = await withRetry(() => notion.views.retrieve({ view_id: ref.id }));
      if (v.name) names.set(v.name, v.id);
    } catch { /* ignore */ }
  }
  return names;
}

/** Crée une vue si son nom n'existe pas déjà sur la base. */
async function ensureView(dataSourceId, dbId, existing, spec) {
  if (existing.has(spec.name)) {
    console.log(`   = "${spec.name}" existe déjà`);
    return existing.get(spec.name);
  }
  const body = {
    data_source_id: dataSourceId,
    database_id: dbId,
    name: spec.name,
    type: spec.type ?? "table",
  };
  if (spec.filter) body.filter = spec.filter;
  if (spec.sorts) body.sorts = spec.sorts;
  if (spec.configuration) body.configuration = spec.configuration;
  const v = await withRetry(() => notion.views.create(body));
  existing.set(spec.name, v.id);
  console.log(`   + "${spec.name}" créée [${v.type ?? spec.type}]`);
  return v.id;
}

// Raccourcis de filtres (les noms de propriété sont acceptés, convertis en id)
const selEq = (prop, val) => ({ property: prop, select: { equals: val } });
const selIn = (prop, vals) => ({ or: vals.map((v) => selEq(prop, v)) });
const dateEmpty = (prop) => ({ property: prop, date: { is_empty: true } });
const dateFilled = (prop) => ({ property: prop, date: { is_not_empty: true } });
const checkbox = (prop, v) => ({ property: prop, checkbox: { equals: v } });
const relEmpty = (prop) => ({ property: prop, relation: { is_empty: true } });
const relFilled = (prop) => ({ property: prop, relation: { is_not_empty: true } });

async function main() {
  // ---------- Appareils : inventaire (mirror /appareils) ----------
  {
    const { dbId, propId } = await dsInfo(APPAREILS_DS);
    const existing = await existingViewNames(dbId);
    console.log("Appareils:");
    await ensureView(APPAREILS_DS, dbId, existing, {
      name: "Par type", type: "board",
      configuration: { type: "board", group_by: { type: "select", property_id: propId["Type"], sort: { type: "manual" } } },
    });
    await ensureView(APPAREILS_DS, dbId, existing, { name: "Au cabinet", filter: selEq("État", "Au cabinet") });
    await ensureView(APPAREILS_DS, dbId, existing, { name: "Dehors (en prêt)", filter: selEq("État", "Dehors") });
    await ensureView(APPAREILS_DS, dbId, existing, { name: "Maintenance / perdus", filter: selIn("État", ["Maintenance", "Perdu", "Réformé"]) });
  }

  // ---------- Examens : queues (mirror /examens) ----------
  {
    const { dbId } = await dsInfo(DS.examens);
    const existing = await existingViewNames(dbId);
    console.log("Examens:");
    await ensureView(DS.examens, dbId, existing, {
      name: "À interpréter",
      filter: { and: [selEq("Statut appareil", "Rendu"), dateEmpty("Date interprétation")] },
    });
    await ensureView(DS.examens, dbId, existing, {
      name: "À envoyer",
      filter: { and: [dateFilled("Date interprétation"), dateEmpty("Date envoi")] },
    });
    await ensureView(DS.examens, dbId, existing, {
      name: "Suivi appareillage",
      filter: { and: [selEq("CAT", "Mettre une PPC"), dateEmpty("Appareillage posé le")] },
    });
    await ensureView(DS.examens, dbId, existing, {
      name: "Appareils dehors",
      filter: selIn("Statut appareil", ["Remis", "Bientôt dû", "En retard"]),
    });
    await ensureView(DS.examens, dbId, existing, { name: "En retard", filter: selEq("Statut appareil", "En retard") });
  }

  // ---------- Dossiers : gate + CR + référence (mirror secretariat/medecin/detail) ----------
  {
    const { dbId } = await dsInfo(DS.dossiers);
    const existing = await existingViewNames(dbId);
    console.log("Dossiers:");
    await ensureView(DS.dossiers, dbId, existing, { name: "À vérifier (secrétariat)", filter: checkbox("Visible médecin", false) });
    await ensureView(DS.dossiers, dbId, existing, { name: "Visibles médecin", filter: checkbox("Visible médecin", true) });
    await ensureView(DS.dossiers, dbId, existing, {
      name: "Comptes rendus à traiter",
      filter: selIn("Statut CR", ["À rédiger", "À valider"]),
    });
    await ensureView(DS.dossiers, dbId, existing, { name: "Dossiers de suite", filter: relFilled("Dossier parent") });
  }

  // ---------- Paiements : finances (mirror /finances) ----------
  {
    const { dbId } = await dsInfo(DS.paiements);
    const existing = await existingViewNames(dbId);
    console.log("Paiements:");
    await ensureView(DS.paiements, dbId, existing, { name: "À relancer", filter: selIn("Statut paiement", ["Impayé", "Partiel"]) });
    await ensureView(DS.paiements, dbId, existing, { name: "Pénalités de retard", filter: selEq("Type de prestation", "Pénalité retard") });
  }

  // ---------- Personnel : équipe par spécialité ----------
  {
    const { dbId, propId } = await dsInfo(DS.personnel);
    const existing = await existingViewNames(dbId);
    console.log("Personnel:");
    if (propId["Spécialité"]) {
      await ensureView(DS.personnel, dbId, existing, {
        name: "Équipe par spécialité", type: "board",
        configuration: { type: "board", group_by: { type: "select", property_id: propId["Spécialité"], sort: { type: "manual" } } },
      });
    }
  }

  console.log("\nTerminé. Vues créées sur les bases. (Onglets visibles en ouvrant chaque base.)");
}
main().catch((e) => { console.error("ÉCHEC:", e?.body ?? e); process.exit(1); });
