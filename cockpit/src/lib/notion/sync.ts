import { notion } from "./client";
import { SOURCES, type SourceSpec } from "./sources";
import { mapPage } from "./mapper";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { drainHorairesToNotion } from "@/lib/horaires-sync";
import { rattraperRecurrences } from "@/lib/taches-recurrence";
import { drainMessagesToNotion } from "@/lib/messages-sync";
import { activerReservationsDues } from "@/lib/appareils-reservations";
import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CHUNK = 200;

async function pullSource(spec: SourceSpec): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | undefined = undefined;
  do {
    const res: any = await notion().dataSources.query({
      data_source_id: spec.dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      if (page.object === "page" && page.properties) rows.push(mapPage(page, spec));
    }
    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);
  return rows;
}

async function upsertRows(db: SupabaseClient, table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await db.from(table).upsert(chunk, { onConflict: "notion_id" });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  // Suppression des lignes qui n'existent plus dans Notion (pull complet).
  const ids = rows.map((r) => r.notion_id as string);
  if (ids.length > 0) {
    const { error } = await db.from(table).delete().not("notion_id", "in", `(${ids.join(",")})`);
    if (error) throw new Error(`${table} (delete): ${error.message}`);
  }
}

export type SyncResult = {
  ok: boolean;
  counts: Record<string, number>;
  errors: string[];
};

/**
 * Pull complet Notion → Supabase pour toutes les bases.
 * Une base qui échoue n'empêche pas les autres (rapportée dans errors).
 */
export async function runSync(triggerSource: string): Promise<SyncResult> {
  const db = supabaseAdmin();
  const { data: run } = await db
    .from("sync_runs")
    .insert({ trigger_source: triggerSource })
    .select("id")
    .single();

  const counts: Record<string, number> = {};
  const errors: string[] = [];

  for (const spec of SOURCES) {
    try {
      const rows = await pullSource(spec);
      if (rows.length > 0) await upsertRows(db, spec.table, rows);
      counts[spec.table] = rows.length;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  // Miroir « write-behind » des horaires : pousse les semaines modifiées vers
  // Notion (throttlé, best-effort) — la même sync 2 h l'entretient sans config.
  try {
    await drainHorairesToNotion();
  } catch {
    // le drainer est best-effort ; ne fait jamais échouer la sync principale
  }

  // Filet des tâches récurrentes : une clôture dont la génération Notion a échoué
  // laisserait la série sans suivante. On répare ici. Idempotent (cf. taches-recurrence).
  try {
    const { crees } = await rattraperRecurrences();
    if (crees > 0) counts["taches_recurrentes_generees"] = crees;
  } catch {
    // best-effort, comme le drainer
  }

  // Miroir des conversations équipe ↔ admin (une page Notion par membre).
  try {
    const res = await drainMessagesToNotion();
    if (res.pushed) counts["messages_notion"] = res.pushed;
  } catch {
    // best-effort
  }

  // Réservations d'appareils arrivées à échéance : l'unité passe « Dehors » le jour de
  // la pose. Sans ça le parc afficherait « Au cabinet » pour un boîtier déjà chez un
  // patient. (La disponibilité, elle, ne dépend pas de ce passage — cf. appareils.ts.)
  try {
    const { actives } = await activerReservationsDues();
    if (actives > 0) counts["reservations_activees"] = actives;
  } catch {
    // best-effort
  }

  const ok = errors.length === 0;
  if (run) {
    await db
      .from("sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: ok ? "success" : "error",
        detail: counts,
        error: errors.length ? errors.join(" | ") : null,
      })
      .eq("id", run.id);
  }

  return { ok, counts, errors };
}
