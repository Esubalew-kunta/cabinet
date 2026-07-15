/**
 * Écritures Notion : constructeurs de propriétés + create/update.
 *
 * Extrait de `actions.ts` pour que les modules serveur hors server-actions
 * (générateur de récurrences, sync…) puissent écrire dans Notion sans importer
 * un fichier « use server » — dont chaque export deviendrait une action
 * appelable en POST direct depuis le navigateur.
 */

import { notion, withNotionRetry } from "@/lib/notion/client";
import { SOURCES } from "@/lib/notion/sources";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ds = (table: string) => {
  const s = SOURCES.find((s) => s.table === table);
  if (!s) throw new Error(`source inconnue: ${table}`);
  return s.dataSourceId;
};

/** Constructeurs de propriétés Notion. Les VALEURS restent en français. */
export const P = {
  title: (v: string) => ({ title: [{ text: { content: v } }] }),
  text: (v: string | null) => ({ rich_text: v ? [{ text: { content: v } }] : [] }),
  select: (v: string | null) => ({ select: v ? { name: v } : null }),
  multi: (v: string[]) => ({ multi_select: v.map((name) => ({ name })) }),
  date: (v: string | null) => ({ date: v ? { start: v } : null }),
  checkbox: (v: boolean) => ({ checkbox: v }),
  number: (v: number | null) => ({ number: v }),
  phone: (v: string | null) => ({ phone_number: v || null }),
  email: (v: string | null) => ({ email: v || null }),
  url: (v: string | null) => ({ url: v || null }),
  relation: (ids: string[]) => ({ relation: ids.map((id) => ({ id })) }),
};

export async function notionUpdate(pageId: string, properties: Record<string, any>) {
  await withNotionRetry(() => notion().pages.update({ page_id: pageId, properties }));
}

export async function notionCreate(table: string, properties: Record<string, any>): Promise<string> {
  const res: any = await withNotionRetry(() =>
    notion().pages.create({
      parent: { type: "data_source_id", data_source_id: ds(table) },
      properties,
    })
  );
  return res.id as string;
}

/** Archive une page (corbeille Notion, restaurable) — jamais de suppression dure. */
export async function notionArchive(pageId: string) {
  await withNotionRetry(() => notion().pages.update({ page_id: pageId, archived: true }));
}
