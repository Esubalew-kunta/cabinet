import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@notionhq/client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadEnv() {
  const raw = readFileSync(join(root, ".env.local"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

export function notionClient() {
  loadEnv();
  return new Client({ auth: process.env.NOTION_TOKEN });
}

export const DS = {
  patients: "7c2756ad-9127-4eff-8d19-f2420664e2aa",
  dossiers: "b37a9ab8-b638-4648-b5f4-b30a86e0e32f",
  taches: "66303da0-61e8-40a5-adfc-0b63ab7c2c14",
  examens: "bb4c7b0c-2af6-457a-b513-eee6304c9a36",
  paiements: "857deea7-c38e-40b0-8926-904197a9bdff",
  perfusions: "9e3904e4-c6c4-4f42-aff5-ff5269c8cc41",
  personnel: "2895672b-5349-4ac6-a505-a6aad98c3495",
  parametres: "3fc46cf9-571e-4482-b2e7-d25a087d707c",
  rapports: "f8a138c4-b695-443f-aefc-8cd94c54eb28",
  taches_perso: "840fa987-9a85-4bc8-b17c-5f9cf39f06f5",
};

export async function withRetry(fn, tries = 4) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = e?.status;
      const retryable = status === 429 || (typeof status === "number" && status >= 500);
      if (!retryable || attempt === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr;
}
