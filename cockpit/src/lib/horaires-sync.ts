/**
 * Drainer « write-behind » du module Horaires (modèle A+B).
 *
 * Supabase est la source de vérité ; Notion ne reçoit qu'UNE page par
 * (secrétaire · semaine). À chaque changement de bloc, l'action marque la
 * semaine `dirty`. Ce drainer prend les semaines dirty, recompose le résumé
 * depuis Supabase et upsert la page Notion — en série et espacé, donc jamais
 * de 429. Idempotent : re-jouer ne fait que réécrire les mêmes pages.
 *
 * Déclenché par POST /api/horaires-sync (bouton membre ou cron n8n).
 * Si HORAIRES_NOTION_DS n'est pas défini, le drainer no-op (Supabase seul) :
 * le module reste 100 % fonctionnel, le miroir Notion s'activera une fois la
 * base créée (scripts/create-horaires-db.mjs) et l'env rechargé.
 */
import { notion, withNotionRetry } from "@/lib/notion/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { blockHours, isoWeek } from "@/lib/horaires";
import type { Horaire } from "@/lib/types";

const BATCH = 25; // bornes le temps d'exécution ; le reste part au tour suivant
const THROTTLE_MS = 350; // ≤ 3 écritures/s → sous la limite Notion

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type DrainResult = { ok: boolean; skipped?: string; pushed?: number; remaining?: number; error?: string };

export async function drainHorairesToNotion(): Promise<DrainResult> {
  const dsId = process.env.HORAIRES_NOTION_DS;
  if (!dsId) return { ok: true, skipped: "HORAIRES_NOTION_DS non défini (miroir Notion inactif)" };

  const admin = supabaseAdmin();
  const { data: dirtyRows, error } = await admin
    .from("horaires_notion_semaines")
    .select("secretaire_notion_id, semaine, notion_page_id")
    .eq("dirty", true)
    .order("updated_at", { ascending: true })
    .limit(BATCH + 1);
  if (error) return { ok: false, error: error.message };

  const dirty = dirtyRows ?? [];
  const remaining = Math.max(0, dirty.length - BATCH);
  const batch = dirty.slice(0, BATCH);
  if (batch.length === 0) return { ok: true, pushed: 0, remaining: 0 };

  // Noms des secrétaires (pour le titre / la propriété Secrétaire)
  const ids = Array.from(new Set(batch.map((d) => d.secretaire_notion_id)));
  const { data: staff } = await admin.from("personnel").select("notion_id, nom").in("notion_id", ids);
  const nameOf = new Map((staff ?? []).map((s) => [s.notion_id as string, (s.nom as string) ?? "?"]));

  let pushed = 0;
  for (const wk of batch) {
    const nom = nameOf.get(wk.secretaire_notion_id) ?? "Secrétaire";
    // Tous les blocs de cette secrétaire, cette semaine (recomposition complète)
    const { data: blocks } = await admin
      .from("horaires_secretariat")
      .select("date, debut, fin, note")
      .eq("secretaire_notion_id", wk.secretaire_notion_id)
      .order("date", { ascending: true })
      .order("debut", { ascending: true });
    const weekBlocks = ((blocks ?? []) as Pick<Horaire, "date" | "debut" | "fin" | "note">[]).filter(
      (b) => isoWeek(b.date) === wk.semaine
    );

    const total = weekBlocks.reduce((s, b) => s + blockHours(b), 0);
    const detail =
      weekBlocks.length === 0
        ? "Aucun horaire cette semaine."
        : weekBlocks.map((b) => `${b.date} : ${b.debut}–${b.fin}${b.note ? ` (${b.note})` : ""}`).join("\n");

    const properties = {
      Titre: { title: [{ text: { content: `${nom} — ${wk.semaine}` } }] },
      "Secrétaire": { rich_text: [{ text: { content: nom } }] },
      Semaine: { rich_text: [{ text: { content: wk.semaine } }] },
      "Heures totales": { number: Math.round(total * 100) / 100 },
      "Détail": { rich_text: [{ text: { content: detail.slice(0, 1900) } }] },
      "Mise à jour": { date: { start: new Date().toISOString().slice(0, 10) } },
    };

    try {
      let pageId = wk.notion_page_id as string | null;
      if (pageId) {
        await withNotionRetry(() => notion().pages.update({ page_id: pageId as string, properties }));
      } else {
        const res = (await withNotionRetry(() =>
          notion().pages.create({ parent: { type: "data_source_id", data_source_id: dsId }, properties })
        )) as { id: string };
        pageId = res.id;
      }
      await admin
        .from("horaires_notion_semaines")
        .update({ dirty: false, notion_page_id: pageId, updated_at: new Date().toISOString() })
        .eq("secretaire_notion_id", wk.secretaire_notion_id)
        .eq("semaine", wk.semaine);
      pushed++;
    } catch {
      // On laisse `dirty=true` : la semaine repassera au prochain tour.
    }
    await wait(THROTTLE_MS);
  }

  return { ok: true, pushed, remaining };
}
