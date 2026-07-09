/*
 * create-abonnes-db.mjs — mailing list ("Abonnés") for the Cabinet Dr Amraoui.
 * Idempotent. Run:  node scripts/create-abonnes-db.mjs
 *
 * What it does (all additive, safe to re-run):
 *   1. Finds the cockpit parent page (parent of the Examens base).
 *   2. Creates the Notion database "Abonnés" under it (once; id cached in
 *      .abonnes-state.json), with: Nom (title), Prénom, Email, Statut,
 *      Source, Date d'inscription.
 *   3. Ensures a `subscribe_url` row exists in Paramètres so the thank-you
 *      email renders the mailing-list button (leave the value empty until
 *      the n8n form is imported + activated, then paste its URL in the
 *      /admin Paramètres editor).
 *   4. Emits n8n-cockpit/WF-D1-subscribe-form.json wired to the real DB id,
 *      ready to import into n8n cloud.
 *
 * The subscription form itself is hosted by n8n (Form Trigger). On submit it
 * creates one page in this Abonnés DB; the cockpit sync can mirror it later.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { notionClient, DS, withRetry } from "./notion-env.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(here, ".abonnes-state.json");
const WF_OUT = join(here, "..", "..", "Patient-Management-System-with-second-brain-main", "n8n-cockpit", "WF-D1-subscribe-form.json");

const notion = notionClient();
const log = (...a) => console.log(...a);
const sel = (...names) => ({ select: { options: names.map((name) => ({ name })) } });

async function getProps(dataSourceId) {
  return withRetry(() => notion.dataSources.retrieve({ data_source_id: dataSourceId }));
}

// ── 1. Cockpit parent page (same walk as schema-upgrade.mjs)
const examensDs = await getProps(DS.examens);
const examensDbId = examensDs.parent?.database_id;
const examensDb = await withRetry(() => notion.databases.retrieve({ database_id: examensDbId }));
let parent = examensDb.parent;
while (parent?.type === "block_id") {
  const block = await withRetry(() => notion.blocks.retrieve({ block_id: parent.block_id }));
  parent = block.parent;
}
const cockpitPageId = parent?.page_id;
if (!cockpitPageId) throw new Error(`Page parente du cockpit introuvable (parent=${JSON.stringify(parent)})`);

// ── 2. Create the Abonnés database (once)
let state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
if (!state.abonnesDatabaseId) {
  const db = await withRetry(() =>
    notion.databases.create({
      parent: { type: "page_id", page_id: cockpitPageId },
      title: [{ type: "text", text: { content: "Abonnés" } }],
      initial_data_source: {
        properties: {
          "Nom": { title: {} },
          "Prénom": { rich_text: {} },
          "Email": { email: {} },
          "Statut": sel("Actif", "Désabonné"),
          "Source": sel("Email remerciement", "Site web", "Sur place", "Autre"),
          "Date d'inscription": { date: {} },
        },
      },
    })
  );
  const dsId = db.data_sources?.[0]?.id;
  state = { abonnesDatabaseId: db.id, abonnesDataSourceId: dsId };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  log("Base Abonnés créée:", db.id, "data source:", dsId);
} else {
  log("Base Abonnés déjà créée:", state.abonnesDatabaseId);
}
// database_id without dashes for API 2022-06-28 parent + n8n
const abonnesDbId = state.abonnesDatabaseId;

// ── 3. Ensure the subscribe_url row in Paramètres (empty value until form is live)
const paramProps = (await getProps(DS.parametres)).properties;
const titleProp = Object.entries(paramProps).find(([, v]) => v.type === "title")?.[0] || "Paramètre";
const valueProp = Object.entries(paramProps).find(([k, v]) => v.type === "rich_text" && /valeur/i.test(k))?.[0]
  || Object.entries(paramProps).find(([, v]) => v.type === "rich_text")?.[0] || "Valeur";

const existing = await withRetry(() =>
  notion.dataSources.query({
    data_source_id: DS.parametres,
    filter: { property: titleProp, title: { equals: "subscribe_url" } },
  })
);
if (existing.results.length === 0) {
  await withRetry(() =>
    notion.pages.create({
      parent: { type: "data_source_id", data_source_id: DS.parametres },
      properties: {
        [titleProp]: { title: [{ text: { content: "subscribe_url" } }] },
        [valueProp]: { rich_text: [{ text: { content: "" } }] },
      },
    })
  );
  log(`Paramètre subscribe_url créé (vide) — colle l'URL du formulaire n8n dans /admin.`);
} else {
  log("Paramètre subscribe_url déjà présent.");
}

// ── 4. Emit the n8n subscribe-form workflow, wired to the real DB id
const buildSubscriberCode = `/*
 * Build one Abonnés page + a branded confirmation email from the form fields.
 * Form Trigger outputs fields keyed by their label: Prénom, Nom, Email.
 */
const BRAND = { headerBg: '#7B1C42', headerText: '#FAF7F2', gold: '#C9A96E', pageBg: '#F5F0E8', bodyText: '#2C1810', muted: '#8C8275', bodyFont: 'Arial, Helvetica, sans-serif', headingFont: 'Georgia, serif' };
const f = $json;
const prenom = String(f['Prénom'] || '').trim();
const nom = String(f['Nom'] || '').trim();
const email = String(f['Email'] || '').trim();
const today = (typeof $now !== 'undefined' && $now && $now.toFormat) ? $now.toFormat('yyyy-LL-dd') : new Date().toISOString().slice(0, 10);
const fullName = [prenom, nom].filter(Boolean).join(' ') || email;

const notion_body = {
  parent: { database_id: '${abonnesDbId}' },
  properties: {
    'Nom': { title: [{ text: { content: fullName } }] },
    'Prénom': { rich_text: [{ text: { content: prenom } }] },
    'Email': { email: email },
    'Statut': { select: { name: 'Actif' } },
    'Source': { select: { name: 'Email remerciement' } },
    "Date d'inscription": { date: { start: today } },
  },
};

const html = \`<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background-color:\${BRAND.pageBg};font-family:\${BRAND.bodyFont};">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:\${BRAND.pageBg};"><tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:8px;overflow:hidden;">
<tr><td style="background-color:\${BRAND.headerBg};padding:32px 40px;">
<p style="margin:0;font-family:\${BRAND.headingFont};font-size:11px;letter-spacing:3px;color:\${BRAND.gold};text-transform:uppercase;">Cardio Check up &middot; Paris</p>
<p style="margin:8px 0 0;font-family:\${BRAND.headingFont};font-size:22px;color:\${BRAND.headerText};line-height:1.3;">Bienvenue parmi nos abonnés</p></td></tr>
<tr><td style="height:3px;background-color:\${BRAND.gold};"></td></tr>
<tr><td style="padding:40px 40px 32px;">
<p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:\${BRAND.bodyText};">Bonjour \${prenom || ''},</p>
<p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:\${BRAND.bodyText};">Merci pour votre inscription. Vous recevrez désormais nos conseils de prévention et de suivi pour prendre soin de votre cœur au quotidien.</p>
<p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:\${BRAND.bodyText};">Vous pouvez vous désinscrire à tout moment en répondant à l'un de nos emails.</p>
<p style="margin:16px 0 0;font-size:16px;color:\${BRAND.bodyText};">Bien à vous,</p>
<p style="margin:8px 0 0;font-family:\${BRAND.headingFont};font-size:15px;color:\${BRAND.headerBg};">Le secrétariat du Dr Amraoui</p></td></tr>
</table></td></tr></table></body></html>\`;

return [{ json: { notion_body, to: email, subject: 'Bienvenue — vos conseils santé du cabinet', html, valid: !!email } }];
`;

const CRED_NOTION = { httpHeaderAuth: { id: "KVkrOeUtFG5Ilhe6", name: "Notion API Token(email automation)" } };
const CRED_GMAIL = { gmailOAuth2: { id: "Q7UEGgHXmqQRSCa0", name: "Gmail OAuth2 API" } };

const workflow = {
  name: "Dr Amraoui Cockpit D1 - Subscribe form",
  nodes: [
    {
      parameters: {
        formTitle: "Conseils santé — Cabinet Dr Amraoui",
        formDescription: "Recevez nos conseils de prévention et de suivi pour votre cœur. Vous pouvez vous désinscrire à tout moment.",
        formFields: {
          values: [
            { fieldLabel: "Prénom", fieldType: "text", requiredField: true },
            { fieldLabel: "Nom", fieldType: "text", requiredField: true },
            { fieldLabel: "Email", fieldType: "email", requiredField: true },
          ],
        },
        responseMode: "lastNode",
        options: { formSubmittedText: "Merci, votre inscription est bien enregistrée. À très bientôt." },
      },
      id: "Subscribe form",
      name: "Subscribe form",
      type: "n8n-nodes-base.formTrigger",
      typeVersion: 2.2,
      position: [240, 0],
      webhookId: "dr-amraoui-subscribe",
    },
    {
      parameters: { jsCode: buildSubscriberCode },
      id: "Build subscriber",
      name: "Build subscriber",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [480, 0],
      onError: "continueRegularOutput",
    },
    {
      parameters: {
        method: "POST",
        url: "https://api.notion.com/v1/pages",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "Notion-Version", value: "2022-06-28" }] },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify($json.notion_body) }}",
        options: {},
      },
      id: "Create subscriber",
      name: "Create subscriber",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [720, 0],
      credentials: CRED_NOTION,
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 2000,
    },
    {
      parameters: {
        sendTo: "={{ $('Build subscriber').item.json.to }}",
        subject: "={{ $('Build subscriber').item.json.subject }}",
        message: "={{ $('Build subscriber').item.json.html }}",
        options: { appendAttribution: false },
      },
      id: "Confirm subscription",
      name: "Confirm subscription",
      type: "n8n-nodes-base.gmail",
      typeVersion: 2.1,
      position: [960, 0],
      webhookId: "confirm-subscription-webhook",
      credentials: CRED_GMAIL,
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 2000,
      onError: "continueRegularOutput",
    },
    {
      parameters: {
        content: "### WF D1 Subscribe form\nn8n hosted form (Prénom, Nom, Email). On submit: creates a page in the Abonnés Notion DB, then sends a branded confirmation email. Copy this form's Production URL into Paramètres > subscribe_url so the thank-you email shows the button.",
        color: 4,
        height: 220,
        width: 520,
      },
      id: "note-d1",
      name: "Note D1",
      type: "n8n-nodes-base.stickyNote",
      typeVersion: 1,
      position: [-300, -300],
    },
  ],
  pinData: {},
  connections: {
    "Subscribe form": { main: [[{ node: "Build subscriber", type: "main", index: 0 }]] },
    "Build subscriber": { main: [[{ node: "Create subscriber", type: "main", index: 0 }]] },
    "Create subscriber": { main: [[{ node: "Confirm subscription", type: "main", index: 0 }]] },
  },
  active: false,
  settings: { executionOrder: "v1" },
  meta: { templateCredsSetupCompleted: true },
  description: "Hosted subscription form for the cabinet mailing list. Writes to the Abonnés Notion DB and confirms by email. Linked from the A3 thank-you email via the subscribe_url setting.",
};

writeFileSync(WF_OUT, JSON.stringify(workflow, null, 2));
log("Workflow écrit:", WF_OUT);
log("\nAbonnés DB id:", abonnesDbId);
log("Prochaine étape: importer WF-D1 dans n8n, l'activer, copier l'URL du formulaire, la coller dans Paramètres > subscribe_url.");
