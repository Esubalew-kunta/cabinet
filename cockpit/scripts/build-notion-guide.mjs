/**
 * 1) Crée une page "📘 Guide du cockpit" (français, par rôle) sous la page
 *    principale, avec un glossaire expliquant chaque file/vue.
 * 2) Ajoute une ligne d'explication en haut de chaque section de files
 *    (Médecin, Secrétariat) pour que l'équipe comprenne d'un coup d'œil.
 * Idempotent, additif, sans risque.
 */
import { notionClient, withRetry } from "./notion-env.mjs";

const notion = notionClient();
const TOP = "9c5c2daa-75c7-82b7-868a-816278e02a8a";
const MEDECIN = "38ac2daa-75c7-81b4-b529-e98a51e91bf9";
const SECRETARIAT = "38ac2daa-75c7-8140-a9e5-f0ba52bced70";

// ---- constructeurs de blocs ----
const rt = (content, opts = {}) => ({ text: { content }, annotations: opts });
const h2 = (t) => ({ heading_2: { rich_text: [rt(t)] } });
const h3 = (t) => ({ heading_3: { rich_text: [rt(t)] } });
const p = (t, gray) => ({ paragraph: { rich_text: [rt(t, gray ? { color: "gray" } : {})] } });
const li = (t) => ({ numbered_list_item: { rich_text: [rt(t)] } });
const bul = (name, expl) => ({
  bulleted_list_item: { rich_text: [rt(name, { bold: true }), rt(expl ? " — " + expl : "")] },
});
const call = (emoji, t, color = "gray_background") => ({ callout: { icon: { emoji }, color, rich_text: [rt(t)] } });
const div = () => ({ divider: {} });

async function children(id) {
  const o = []; let c;
  do { const r = await withRetry(() => notion.blocks.children.list({ block_id: id, page_size: 100, start_cursor: c })); o.push(...r.results); c = r.has_more ? r.next_cursor : undefined; } while (c);
  return o;
}
async function appendChunked(pageId, blocks, after) {
  for (let i = 0; i < blocks.length; i += 50) {
    const body = { block_id: pageId, children: blocks.slice(i, i + 50) };
    if (after && i === 0) body.after = after;
    await withRetry(() => notion.blocks.children.append(body));
  }
}

const GUIDE = [
  call("📘", "Comment utiliser le cockpit — les mêmes gestes que l'application web. Chaque patient suit le même parcours.", "blue_background"),

  h2("Le parcours unique"),
  p("Quel que soit le canal (téléphone, WhatsApp, Doctolib, sur place), chaque patient suit :"),
  call("➡️", "Patient → Dossier → Examen / Appareil → Paiement → Compte rendu → Prochain RDV"),
  p("Chaque cas ci-dessous n'est que ce parcours, raccourci ou allongé selon la visite.", true),

  h2("Qui fait quoi"),
  bul("Secrétariat", "enregistre, vérifie, pose les appareils, encaisse."),
  bul("Médecin", "lit les dossiers vérifiés, interprète, rédige le compte rendu."),
  bul("Automatique", "l'application envoie les e-mails au patient à chaque étape."),

  div(),
  h2("🟦 Secrétariat"),
  h3("Nouveau patient + dossier"),
  li("Patients → Nouveau patient : nom, date de naissance, téléphone."),
  li("Nouveau dossier : motif, Source (téléphone / sur place…), médecin."),
  li("Vérifier ✓ — le dossier devient visible au médecin."),
  h3("Poser un appareil"),
  li("Examens → Nouvel examen : type, choisir une unité libre, date de pose. L'appareil passe « dehors ». Faire signer le consentement papier."),
  li("Au retour : Marquer rendu — l'unité revient « au cabinet », l'examen passe « à interpréter »."),
  li("En retard : la ligne affiche « X j · montant » → Facturer la pénalité (montant déjà calculé)."),
  h3("Encaisser"),
  li("Encaisser : montant + mode de paiement. Le statut (Payé / Partiel) et le solde se calculent seuls."),

  div(),
  h2("🩺 Médecin"),
  li("Ouvrir un dossier vérifié depuis la page Médecin."),
  li("Consulter, mettre le compte rendu à « Envoyé » (la date se pose seule), cocher « Ordonnance remise »."),
  li("Examens à interpréter : saisir les résultats ; pour une polygraphie, choisir la CAT (conduite à tenir)."),
  li("Si CAT = Mettre une PPC → le patient entre dans « Suivi appareillage » jusqu'à la pose et les RDV de suite."),
  li("Besoin d'un confrère ? Sur le dossier : Créer un dossier de suite (chirurgien, angiologue…)."),

  div(),
  h2("Les files (vues) — à quoi elles servent"),
  p("Chaque carte des tableaux de bord ouvre une de ces files filtrées :"),
  bul("Suivi appareillage", "polygraphies où il faut mettre une PPC : contacter le patient, choisir la société d'appareillage, poser la PPC, puis noter les RDV de suite (PGV avec Rita, pneumologue). La file se vide quand tout est fait — aucun patient d'apnée n'est oublié après le diagnostic."),
  bul("À interpréter", "appareils rendus, résultats à lire."),
  bul("À envoyer", "comptes rendus interprétés, à transmettre au médecin traitant."),
  bul("Appareils dehors", "boîtiers remis, bientôt dus ou en retard."),
  bul("En retard", "boîtiers non restitués à l'échéance (pénalité possible)."),
  bul("Comptes rendus à traiter", "dossiers dont le compte rendu est à rédiger ou à valider."),
  bul("Dossiers à vérifier", "dossiers pas encore validés par le secrétariat (invisibles au médecin)."),
  bul("Dossiers de suite", "la chaîne de référence (cardiologie → chirurgien, angiologue…)."),
  bul("Inventaire des appareils", "le parc physique : au total, au cabinet, dehors, en retard."),
  bul("Paiements à relancer", "impayés et partiels."),

  div(),
  h2("Bon à savoir"),
  bul("La porte médecin est réelle", "un médecin ne voit un dossier qu'après le Vérifier ✓ du secrétariat."),
  bul("Les montants sont calculés, jamais saisis", "soldes, pénalités, jours de retard."),
  bul("Aucun contenu de médicament n'est stocké", "seulement l'indicateur « ordonnance remise »."),
  bul("Langue", "bascule FR / EN en bas du menu de l'application."),
];

async function ensureGuidePage() {
  for (const b of await children(TOP)) {
    if (b.type === "child_page" && b.child_page.title.includes("Guide")) {
      console.log(`Guide déjà présent : "${b.child_page.title}" [${b.id}]`);
      return null;
    }
  }
  const page = await withRetry(() => notion.pages.create({
    parent: { type: "page_id", page_id: TOP },
    icon: { type: "emoji", emoji: "📘" },
    properties: { title: { title: [rt("Guide du cockpit")] } },
  }));
  await appendChunked(page.id, GUIDE);
  console.log(`Guide créé [${page.id}] — ${GUIDE.length} blocs`);
  return page.id;
}

/** Ajoute une ligne d'intro juste sous le titre de section (si absente). */
async function labelSection(pageId, headingContains, introText) {
  const blocks = await children(pageId);
  const idx = blocks.findIndex((b) => {
    const t = b[b.type]?.rich_text;
    return Array.isArray(t) && t.map((x) => x.plain_text).join("").includes(headingContains);
  });
  if (idx === -1) { console.log(`(section "${headingContains}" introuvable sur ${pageId})`); return; }
  const next = blocks[idx + 1];
  const nextTxt = next?.[next?.type]?.rich_text?.map((x) => x.plain_text).join("") ?? "";
  if (nextTxt.startsWith(introText.slice(0, 20))) { console.log(`= intro déjà présente (${headingContains})`); return; }
  await appendChunked(pageId, [p(introText, true)], blocks[idx].id);
  console.log(`+ intro ajoutée sous "${headingContains}"`);
}

async function main() {
  await ensureGuidePage();
  await labelSection(MEDECIN, "Files cliniques", "À quoi sert chaque file : voir la page « Guide du cockpit ». Un clic ouvre la vue filtrée.");
  await labelSection(SECRETARIAT, "Files secrétariat", "À quoi sert chaque file : voir la page « Guide du cockpit ». Un clic ouvre la vue filtrée.");
  console.log("\nTerminé.");
}
main().catch((e) => { console.error("ÉCHEC:", e?.body ?? e); process.exit(1); });
