import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Lang } from "@/lib/i18n/dict";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Marqueur de valeur absente dans les tableaux (pas de tiret cadratin). */
export const EMPTY = "·";

const NUM_LOCALE: Record<Lang, string> = { fr: "fr-FR", en: "en-GB" };

export function formatEuro(n: number | null | undefined, lang: Lang = "fr"): string {
  if (n === null || n === undefined) return EMPTY;
  return new Intl.NumberFormat(NUM_LOCALE[lang], { style: "currency", currency: "EUR" }).format(n);
}

export function formatDate(d: string | null | undefined, lang: Lang = "fr"): string {
  if (!d) return EMPTY;
  const date = new Date(d);
  if (isNaN(date.getTime())) return EMPTY;
  const hasTime = d.includes("T") && !d.endsWith("T00:00:00.000Z");
  return new Intl.DateTimeFormat(NUM_LOCALE[lang], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(hasTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

/** Extract Notion page id (uuid without dashes ok) from a notion page URL */
export function notionIdFromUrl(url: string): string {
  const m = url.match(/([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/i);
  if (!m) return url;
  const raw = m[1].replace(/-/g, "");
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}
