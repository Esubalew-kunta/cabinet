/**
 * Drainer « write-behind » du module Messages (même modèle que les Horaires).
 *
 * Supabase est la source de vérité ; Notion ne reçoit qu'UNE page par membre,
 * portant la transcription. Chaque envoi marque la page `dirty` ; ce drainer prend
 * les pages dirty, recompose la transcription depuis Supabase et upsert la page —
 * en série et espacé, donc jamais de 429. Idempotent : rejouer réécrit la même page.
 *
 * Déclenché par la sync globale (/api/sync, cron 2 h).
 * Sans MESSAGES_NOTION_DS, no-op : le module reste 100 % fonctionnel sur Supabase
 * seul, le miroir s'activera après scripts/create-messages-db.mjs.
 *
 * NB : contrairement au drainer Horaires, on repasse bien `sync_state` à 'synced'.
 * Là-bas la colonne est posée à 'pending' et jamais rebasculée — colonne et index
 * partiel morts. Ne pas reproduire.
 */
import { notion, withNotionRetry } from "@/lib/notion/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

const BATCH = 25; // borne le temps d'exécution ; le reste part au tour suivant
const THROTTLE_MS = 350; // ≤ 3 écritures/s → sous la limite Notion
const MAX_CHARS = 1900; // Notion : 2000 max par bloc rich_text

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type DrainResult = { ok: boolean; skipped?: string; pushed?: number; remaining?: number; error?: string };

export async function drainMessagesToNotion(): Promise<DrainResult> {
  const dsId = process.env.MESSAGES_NOTION_DS;
  if (!dsId) return { ok: true, skipped: "MESSAGES_NOTION_DS non défini (miroir Notion inactif)" };

  const admin = supabaseAdmin();
  const { data: dirtyRows, error } = await admin
    .from("messages_notion_pages")
    .select("personnel_notion_id, notion_page_id")
    .eq("dirty", true)
    .order("updated_at", { ascending: true })
    .limit(BATCH + 1);
  if (error) return { ok: false, error: error.message };

  const dirty = dirtyRows ?? [];
  const remaining = Math.max(0, dirty.length - BATCH);
  const batch = dirty.slice(0, BATCH);
  if (batch.length === 0) return { ok: true, pushed: 0, remaining: 0 };

  const ids = Array.from(new Set(batch.map((d) => d.personnel_notion_id)));
  const { data: staff } = await admin.from("personnel").select("notion_id, nom").in("notion_id", ids);
  const nameOf = new Map((staff ?? []).map((s) => [s.notion_id as string, (s.nom as string) ?? "?"]));

  let pushed = 0;
  for (const row of batch) {
    try {
      const { data: conv } = await admin
        .from("conversations")
        .select("id, dernier_message_at")
        .eq("personnel_notion_id", row.personnel_notion_id)
        .maybeSingle();
      if (!conv) continue;

      // Borné : une transcription Notion est un miroir de lecture, pas une archive.
      const { data: msgs } = await admin
        .from("messages")
        .select("id, corps, est_admin, created_at")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: true })
        .limit(200);

      const nom = nameOf.get(row.personnel_notion_id) ?? "?";
      const transcript = (msgs ?? [])
        .map((m) => {
          const qui = m.est_admin ? "Dr Amraoui" : nom;
          const quand = (m.created_at ?? "").slice(0, 16).replace("T", " ");
          return `[${quand}] ${qui} : ${m.corps}`;
        })
        .join("\n")
        .slice(-MAX_CHARS);

      const props: Record<string, unknown> = {
        Titre: { title: [{ text: { content: `Messages — ${nom}` } }] },
        Membre: { rich_text: [{ text: { content: nom } }] },
        "Derniers échanges": { rich_text: [{ text: { content: transcript || "(vide)" } }] },
        "Mise à jour": { date: { start: new Date().toISOString() } },
        "Nombre de messages": { number: (msgs ?? []).length },
      };

      let pageId = row.notion_page_id;
      if (pageId) {
        await withNotionRetry(() => notion().pages.update({ page_id: pageId!, properties: props as never }));
      } else {
        const res = await withNotionRetry(() =>
          notion().pages.create({
            parent: { type: "data_source_id", data_source_id: dsId },
            properties: props as never,
          })
        );
        pageId = (res as { id: string }).id;
      }

      await admin
        .from("messages_notion_pages")
        .update({ notion_page_id: pageId, dirty: false, updated_at: new Date().toISOString() })
        .eq("personnel_notion_id", row.personnel_notion_id);

      // Contrairement aux Horaires : on referme bien le cycle pending → synced.
      await admin.from("messages").update({ sync_state: "synced" }).eq("conversation_id", conv.id).eq("sync_state", "pending");

      pushed++;
      await wait(THROTTLE_MS);
    } catch {
      // best-effort : une conversation en échec ne bloque pas les autres ni la sync
    }
  }

  return { ok: true, pushed, remaining };
}
