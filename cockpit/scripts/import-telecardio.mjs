/*
 * One-off seed: import the Excel « Patients à facturer Dr AMRAOUI tableau de 2025 »
 * into the Télécardiologie tables (telecardio_patients + telecardio_statuts).
 *
 * The .xlsx is parsed directly (it is a zip of XML) — no new dependency. Values are
 * normalized to the tri-state Oui/Non/vide; the month columns become one status row
 * per (patient, month). Idempotent-ish: refuses to run if data already exists unless
 * --force is passed (which wipes both tables first).
 *
 * Usage:
 *   node scripts/import-telecardio.mjs "../Patients à facturer Dr AMRAOUI tableau de 2025.xlsx"
 *   node scripts/import-telecardio.mjs <path> --force
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadEnv } from "./notion-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv();

const args = process.argv.slice(2);
const force = args.includes("--force");
const xlsxArg = args.find((a) => !a.startsWith("--"));
const xlsxPath = resolve(root, xlsxArg ?? "../Patients à facturer Dr AMRAOUI tableau de 2025.xlsx");

// ---------- .xlsx parsing (unzip via system unzip, then read XML) ----------

function unzipXlsx(path) {
  const dir = mkdtempSync(join(tmpdir(), "telecardio-"));
  execFileSync("unzip", ["-o", path, "-d", dir], { stdio: "ignore" });
  return dir;
}

function colToNum(c) {
  let n = 0;
  for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseXlsx(path) {
  const dir = unzipXlsx(path);
  const ssXml = readFileSync(join(dir, "xl/sharedStrings.xml"), "utf8");
  const strings = [...ssXml.matchAll(/<si>(.*?)<\/si>/gs)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)]
      .map((t) => t[1])
      .join("")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
  );
  const xml = readFileSync(join(dir, "xl/worksheets/sheet1.xml"), "utf8");
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>(.*?)<\/row>/gs)) {
    const cells = {};
    for (const cm of rm[2].matchAll(
      /<c r="([A-Z]+)\d+"(?:[^>]*t="([^"]*)")?[^>]*>(?:<v>(.*?)<\/v>|<is><t[^>]*>(.*?)<\/t><\/is>)?<\/c>/gs
    )) {
      const col = colToNum(cm[1]);
      const t = cm[2];
      let v = cm[3] !== undefined ? cm[3] : cm[4];
      if (v === undefined) continue;
      if (t === "s") v = strings[+v];
      cells[col] = v;
    }
    rows.push({ rn: +rm[1], cells });
  }
  return rows;
}

// ---------- normalization (mirror of src/lib/telecardio.ts) ----------

function normalizeFacture(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "oui" || s === "o" || s === "yes") return true;
  if (s === "non" || s === "n" || s === "no") return false;
  return null;
}

function serialToISO(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 20000 || n > 60000) return null; // garde-fou : vraie date Excel
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
}

function serialToMonthISO(v) {
  const iso = serialToISO(v);
  return iso ? iso.slice(0, 7) + "-01" : null;
}

// ---------- header → month mapping ----------

/**
 * Colonnes 10 et 11 = les deux instantanés (« Facturation au 01/11/23 », « …01/05/24 »).
 * Colonnes 12→28 = un mois par colonne (dates Excel dans l'entête).
 * 01/05/24 (col 11) et mai 2024 (col 12) sont le MÊME mois : la colonne mensuelle,
 * plus fine, l'emporte si elle est renseignée (on traite col 11 avant col 12).
 */
function buildColumnMonths(header) {
  const map = {}; // colIndex -> 'YYYY-MM-01'
  map[10] = "2023-11-01";
  map[11] = "2024-05-01";
  for (let c = 12; c <= 28; c++) {
    const mo = serialToMonthISO(header.cells[c]);
    if (mo) map[c] = mo;
  }
  return map;
}

const NOTE_RE = /partir|20\d\d/i;

// ---------- build records ----------

function buildRecords(rows) {
  const header = rows.find((r) => r.rn === 1);
  const colMonths = buildColumnMonths(header);

  const patients = [];
  let categorie = "prothese";
  let ordre = 0;

  for (const r of rows) {
    if (r.rn === 1) continue;
    const c = r.cells;
    const nom = (c[1] ?? "").toString().trim();

    // Marqueur de section « HOLTERS implantables » : bascule la catégorie, pas un patient.
    if (/holters?\s+implantables/i.test(nom)) {
      categorie = "holter";
      continue;
    }

    // Ligne vide (ni nom, ni aucune donnée) → ignorée.
    const hasAny = Object.values(c).some((v) => (v ?? "").toString().trim() !== "");
    if (!nom && !hasAny) continue;
    if (!nom) continue; // sans nom, rien à afficher

    // col 2 = prénom, SAUF quand c'est une note (« à partir janvier 2026 »).
    let prenom = (c[2] ?? "").toString().trim() || null;
    const extraNotes = [];
    if (prenom && NOTE_RE.test(prenom)) {
      extraNotes.push(prenom);
      prenom = null;
    }

    const comment = (c[29] ?? "").toString().trim();
    if (comment) extraNotes.push(comment);

    ordre += 1;
    const statuts = {};
    for (const [colStr, mois] of Object.entries(colMonths)) {
      const val = normalizeFacture(c[+colStr]);
      if (val !== null) statuts[mois] = val; // col mensuelle (plus tardive) écrase l'instantané
    }

    patients.push({
      ordre,
      nom,
      prenom,
      sexe: (c[3] ?? "").toString().trim() || null,
      date_naissance: serialToISO(c[4]),
      date_implantation: serialToISO(c[5]),
      date_debut_hm: serialToISO(c[9]),
      num_serie: (c[6] ?? "").toString().trim() || null,
      num_pid: (c[7] ?? "").toString().trim() || null,
      type_appareil: (c[8] ?? "").toString().trim() || null,
      categorie,
      commentaire: extraNotes.length ? extraNotes.join(" · ") : null,
      statuts,
    });
  }
  return patients;
}

// ---------- write ----------

async function main() {
  if (!process.env.SUPABASE_DB_URL) {
    console.error("SUPABASE_DB_URL manquant dans .env.local");
    process.exit(1);
  }

  const rows = parseXlsx(xlsxPath);
  const patients = buildRecords(rows);
  const totalStatuts = patients.reduce((n, p) => n + Object.keys(p.statuts).length, 0);
  console.log(`Parsed: ${patients.length} patient(s), ${totalStatuts} monthly status cell(s).`);

  const db = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  const { rows: existing } = await db.query("select count(*)::int as n from telecardio_patients");
  if (existing[0].n > 0 && !force) {
    console.error(
      `telecardio_patients contient déjà ${existing[0].n} ligne(s). ` +
        `Relancez avec --force pour tout remplacer.`
    );
    await db.end();
    process.exit(1);
  }

  try {
    await db.query("begin");
    if (force) {
      await db.query("delete from telecardio_statuts");
      await db.query("delete from telecardio_patients");
    }

    // Ids générés côté client → un seul INSERT groupé pour les patients, puis des
    // INSERT groupés pour les statuts (bien plus rapide que ligne par ligne sur une
    // base distante).
    const PCOLS = 13;
    const pValues = [];
    const pParams = [];
    for (const p of patients) {
      p.id = randomUUID();
      const b = pParams.length;
      pValues.push(`(${Array.from({ length: PCOLS }, (_, i) => `$${b + i + 1}`).join(",")})`);
      pParams.push(
        p.id, p.nom, p.prenom, p.sexe, p.date_naissance, p.date_implantation, p.date_debut_hm,
        p.num_serie, p.num_pid, p.type_appareil, p.categorie, p.commentaire, p.ordre
      );
    }
    await db.query(
      `insert into telecardio_patients
         (id, nom, prenom, sexe, date_naissance, date_implantation, date_debut_hm,
          num_serie, num_pid, type_appareil, categorie, commentaire, ordre)
       values ${pValues.join(",")}`,
      pParams
    );

    // Statuts en lots de 500 tuples.
    const flat = [];
    for (const p of patients) {
      for (const [mois, facture] of Object.entries(p.statuts)) flat.push([p.id, mois, facture]);
    }
    for (let i = 0; i < flat.length; i += 500) {
      const chunk = flat.slice(i, i + 500);
      const vals = [];
      const params = [];
      for (const [pid, mois, facture] of chunk) {
        const b = params.length;
        vals.push(`($${b + 1},$${b + 2},$${b + 3})`);
        params.push(pid, mois, facture);
      }
      await db.query(
        `insert into telecardio_statuts (patient_id, mois, facture) values ${vals.join(",")}
         on conflict (patient_id, mois) do update set facture = excluded.facture`,
        params
      );
    }

    await db.query("commit");
    console.log(`Done. Inserted ${patients.length} patient(s) and ${totalStatuts} status cell(s).`);
  } catch (e) {
    await db.query("rollback");
    console.error("Rollback:", e.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();
