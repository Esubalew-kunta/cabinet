// Crée le premier compte admin (une seule fois) : node scripts/create-admin.mjs email@x.fr
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/create-admin.mjs email@exemple.fr");
  process.exit(1);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

// mot de passe lisible : xxxx-xxxx-xxxx-NN
const cons = "bcdfghjklmnprstvwz", voy = "aeiou";
const block = () =>
  Array.from({ length: 2 }, () =>
    cons[crypto.randomInt(cons.length)] + voy[crypto.randomInt(voy.length)]
  ).join("");
const password = `${block()}-${block()}-${block()}-${crypto.randomInt(10, 99)}`;

const { data: created, error: authErr } = await db.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (authErr) {
  console.error("Auth:", authErr.message);
  process.exit(1);
}

const { error: insErr } = await db.from("app_members").insert({
  auth_user_id: created.user.id,
  email: email.toLowerCase(),
  nom: "Admin",
  role: "admin",
  is_owner: false,
  active: true,
});
if (insErr) {
  console.error("app_members:", insErr.message);
  process.exit(1);
}

console.log("✅ Compte admin créé");
console.log("   Email        :", email);
console.log("   Mot de passe :", password);
