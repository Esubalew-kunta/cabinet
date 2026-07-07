// Vérifie que le schéma est en place (utilise .env.local)
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

const tables = [
  "patients", "dossiers", "taches", "examens", "paiements", "perfusions",
  "personnel", "parametres", "rapports", "taches_perso",
  "app_members", "app_permissions", "sync_runs",
];

for (const t of tables) {
  const { count, error } = await db.from(t).select("*", { count: "exact", head: true });
  console.log(t.padEnd(16), error ? "ERR: " + error.message : "ok, rows=" + count);
}

const { data: view, error: viewErr } = await db.from("v_paiements_mes_patients").select("*").limit(1);
console.log("v_paiements_mes_patients", viewErr ? "ERR: " + viewErr.message : "ok");
