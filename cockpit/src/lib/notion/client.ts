import { Client } from "@notionhq/client";

let _client: Client | null = null;

export function notion(): Client {
  if (!_client) {
    _client = new Client({ auth: process.env.NOTION_TOKEN });
  }
  return _client;
}

/**
 * Réessaie un appel Notion en cas de 429 (rate limit) ou 5xx, en respectant
 * Retry-After. L'UI n'attend pas : le miroir Supabase est déjà à l'écran.
 */
export async function withNotionRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number }).status;
      const retryable = status === 429 || (typeof status === "number" && status >= 500);
      if (!retryable || attempt === tries - 1) throw e;
      const headers = (e as { headers?: Record<string, string> }).headers;
      const retryAfter = Number(headers?.["retry-after"] ?? 0);
      const delayMs = retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.min(delayMs, 8000)));
    }
  }
  throw lastErr;
}
