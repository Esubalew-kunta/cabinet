/**
 * Mapper pur : page Notion → ligne Supabase.
 * Aucune dépendance réseau — testé unitairement.
 */

import type { PropKind, SourceSpec } from "./sources";

/* eslint-disable @typescript-eslint/no-explicit-any */
type NotionProperty = any;
type NotionPage = {
  id: string;
  created_time?: string;
  last_edited_time?: string;
  properties: Record<string, NotionProperty>;
};

function plainText(arr: Array<{ plain_text?: string }> | undefined): string | null {
  if (!arr || arr.length === 0) return null;
  const s = arr.map((t) => t.plain_text ?? "").join("");
  return s === "" ? null : s;
}

/** Si la propriété attendue est absente, tente de la retrouver par type. */
function findByType(props: Record<string, NotionProperty>, type: string): NotionProperty | undefined {
  return Object.values(props).find((p) => p?.type === type);
}

export function mapProperty(prop: NotionProperty, kind: PropKind): unknown {
  if (prop === undefined || prop === null) return kind === "relation" || kind === "multi_select" ? [] : null;
  switch (kind) {
    case "title":
      return plainText(prop.title);
    case "rich_text":
      return plainText(prop.rich_text);
    case "number":
      return prop.number ?? null;
    case "select":
      return prop.select?.name ?? null;
    case "multi_select":
      return (prop.multi_select ?? []).map((o: { name: string }) => o.name);
    case "date":
      return prop.date?.start ?? null;
    case "checkbox":
      return prop.checkbox ?? false;
    case "email":
      return prop.email ?? null;
    case "phone":
      return prop.phone_number ?? null;
    case "url":
      return prop.url ?? null;
    case "relation":
      return (prop.relation ?? []).map((r: { id: string }) => r.id);
    case "unique_id":
      return prop.unique_id?.number ?? null;
    default:
      return null;
  }
}

export function mapPage(page: NotionPage, spec: SourceSpec): Record<string, unknown> {
  const row: Record<string, unknown> = {
    notion_id: page.id,
    created_time: page.created_time ?? null,
    last_edited_time: page.last_edited_time ?? null,
    raw: page.properties,
    synced_at: new Date().toISOString(),
  };
  for (const { prop, column, kind } of spec.props) {
    let p = page.properties[prop];
    // tolérance : le titre peut avoir un autre nom dans une base inconnue
    if (p === undefined && kind === "title") p = findByType(page.properties, "title");
    row[column] = mapProperty(p, kind);
  }
  return row;
}
