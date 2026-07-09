"use server";

/**
 * Écritures : Notion d'abord (source de vérité), puis miroir Supabase
 * optimiste pour que l'UI soit à jour immédiatement.
 * Toutes les actions vérifient la session + permission.
 */

import { revalidatePath } from "next/cache";
import { notion, withNotionRetry } from "@/lib/notion/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSession, can } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { SOURCES } from "@/lib/notion/sources";

/* eslint-disable @typescript-eslint/no-explicit-any */

const ds = (table: string) => {
  const s = SOURCES.find((s) => s.table === table);
  if (!s) throw new Error(`source inconnue: ${table}`);
  return s.dataSourceId;
};

// ---------- constructeurs de propriétés Notion ----------
const P = {
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

async function notionUpdate(pageId: string, properties: Record<string, any>) {
  await withNotionRetry(() => notion().pages.update({ page_id: pageId, properties }));
}

async function notionCreate(table: string, properties: Record<string, any>): Promise<string> {
  const res: any = await withNotionRetry(() =>
    notion().pages.create({
      parent: { type: "data_source_id", data_source_id: ds(table) },
      properties,
    })
  );
  return res.id as string;
}

function refresh() {
  for (const p of ["/secretariat", "/medecin", "/patients", "/taches", "/finances", "/admin", "/examens", "/perfusions", "/appareils", "/dossiers", "/inventaire"]) {
    revalidatePath(p, "layout");
  }
}

type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Erreur inattendue" };
}

// ============================================================
// Dossiers
// ============================================================

/** La secrétaire marque le dossier Vérifié → il devient visible au médecin. */
export async function verifierDossier(dossierId: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "dossiers_all")) return { ok: false, error: "Accès refusé" };

    await notionUpdate(dossierId, {
      "Revue secrétaire": P.multi(["Vérifié"]),
      "Visible médecin": P.checkbox(true),
      "Statut intake": P.select("Prêt"),
      "Statut médecin": P.select("À lire"),
    });
    await supabaseAdmin()
      .from("dossiers")
      .update({
        revue_secretaire: ["Vérifié"],
        visible_medecin: true,
        statut_intake: "Prêt",
        statut_medecin: "À lire",
      })
      .eq("notion_id", dossierId);
    await logAudit(session, { action: "verify", area: "dossiers", targetId: dossierId });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Annuler la vérification : le dossier redevient « en attente » (secrétaire seule). */
export async function devérifierDossier(dossierId: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "dossiers_all")) return { ok: false, error: "Accès refusé" };
    await notionUpdate(dossierId, {
      "Revue secrétaire": P.multi(["À faire"]),
      "Visible médecin": P.checkbox(false),
      "Statut intake": P.select("Nouveau"),
      "Statut médecin": P.select("Non visible"),
    });
    await supabaseAdmin()
      .from("dossiers")
      .update({ revue_secretaire: ["À faire"], visible_medecin: false, statut_intake: "Nouveau", statut_medecin: "Non visible" })
      .eq("notion_id", dossierId);
    await logAudit(session, { action: "verify", area: "dossiers", targetId: dossierId, detail: { unverified: true } });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setStatutIntake(dossierId: string, statut: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "dossiers_all")) return { ok: false, error: "Accès refusé" };
    await notionUpdate(dossierId, { "Statut intake": P.select(statut) });
    await supabaseAdmin().from("dossiers").update({ statut_intake: statut }).eq("notion_id", dossierId);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setStatutMedecin(dossierId: string, statut: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "dossiers_all") && !can(session, "dossiers_own")) return { ok: false, error: "Accès refusé" };
    const patch: Record<string, any> = { "Statut médecin": P.select(statut) };
    const mirror: Record<string, unknown> = { statut_medecin: statut };
    if (statut === "Terminé") {
      patch["Statut intake"] = P.select("Terminé");
      mirror.statut_intake = "Terminé";
    }
    await notionUpdate(dossierId, patch);
    await supabaseAdmin().from("dossiers").update(mirror).eq("notion_id", dossierId);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * « Nouveau dossier » : le canal d'arrivée (Source) est enregistré, le dossier
 * démarre NON visible au médecin (la porte reste fermée jusqu'au Vérifier ✓).
 * Sert aussi au « dossier de suite » (référence) via dossier_parent.
 */
export async function creerDossier(input: {
  patient: string;
  motif: string;
  source?: string | null;
  site?: string | null;
  rendez_vous?: string | null;
  resume?: string | null;
  priorite?: string | null;
  medecin?: string | null;
  dossier_parent?: string | null;
  verifie?: boolean; // créer déjà vérifié (visible au médecin) au lieu de « en attente »
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "dossiers_all") && !input.dossier_parent) return { ok: false, error: "Accès refusé" };
    // Un médecin peut créer un dossier de suite pour ses patients (référence)
    if (!can(session, "dossiers_all") && !can(session, "dossiers_own")) return { ok: false, error: "Accès refusé" };
    if (!input.patient) return { ok: false, error: "Patient requis" };
    if (!input.motif) return { ok: false, error: "Motif requis" };

    const ref = `DOS-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
    // Vérifié (bascule) = visible au médecin ; sinon « en attente », vu de la seule secrétaire.
    const v = input.verifie === true;

    const props: Record<string, any> = {
      "ID Dossier": P.title(ref),
      Patient: P.relation([input.patient]),
      Motif: P.select(input.motif),
      "Statut intake": P.select(v ? "Prêt" : "Nouveau"),
      "Revue secrétaire": P.multi([v ? "Vérifié" : "À faire"]),
      "Statut médecin": P.select(v ? "À lire" : "Non visible"),
      "Visible médecin": P.checkbox(v),
      Priorité: P.select(input.priorite ?? "Normale"),
    };
    if (input.source) props["Source"] = P.select(input.source);
    if (input.site) props["Site"] = P.select(input.site);
    if (input.rendez_vous) props["Rendez-vous"] = P.date(input.rendez_vous);
    if (input.resume) props["Résumé motif"] = P.text(input.resume);
    if (input.medecin) props["Médecin assigné"] = P.relation([input.medecin]);
    if (input.dossier_parent) props["Dossier parent"] = P.relation([input.dossier_parent]);

    const pageId = await notionCreate("dossiers", props);

    const admin = supabaseAdmin();
    await admin.from("dossiers").insert({
      notion_id: pageId,
      id_dossier: ref,
      patient: [input.patient],
      motif: input.motif,
      source: input.source ?? null,
      site: input.site ?? null,
      rendez_vous: input.rendez_vous ?? null,
      resume_motif: input.resume ?? null,
      priorite: input.priorite ?? "Normale",
      statut_intake: v ? "Prêt" : "Nouveau",
      revue_secretaire: [v ? "Vérifié" : "À faire"],
      statut_medecin: v ? "À lire" : "Non visible",
      visible_medecin: v,
      medecin_assigne: input.medecin ? [input.medecin] : [],
      dossier_parent: input.dossier_parent ? [input.dossier_parent] : [],
      created_time: new Date().toISOString(),
    });

    // Tâche de triage : chaque nouveau cas atterrit chez la Dre par défaut
    // (décision 8 juil. — sur le dossier uniquement, pas de date d'échéance).
    // Best effort : l'échec de la tâche ne bloque pas la création du dossier.
    try {
      const { data: owner } = await admin
        .from("app_members")
        .select("personnel_notion_id")
        .eq("is_owner", true)
        .not("personnel_notion_id", "is", null)
        .limit(1)
        .maybeSingle();
      const responsable = owner?.personnel_notion_id ?? null;
      const { data: pat } = await admin
        .from("patients")
        .select("nom")
        .eq("notion_id", input.patient)
        .maybeSingle();
      const titre = `Prendre en charge — ${pat?.nom ?? ref}`;

      const tProps: Record<string, any> = {
        Titre: P.title(titre),
        Statut: P.select("À faire"),
        Domaine: P.select("Clinique"),
        Priorité: P.select("Normale"),
        Calendrier: P.select("Ponctuelle"),
        "Patient lié": P.relation([input.patient]),
        "Dossier lié": P.relation([pageId]),
      };
      if (responsable) tProps["Responsable"] = P.relation([responsable]);
      if (session.member.personnel_notion_id) tProps["Créé par"] = P.relation([session.member.personnel_notion_id]);

      const tacheId = await notionCreate("taches", tProps);
      await admin.from("taches").insert({
        notion_id: tacheId,
        titre,
        statut: "À faire",
        domaine: "Clinique",
        priorite: "Normale",
        calendrier: "Ponctuelle",
        responsable: responsable ? [responsable] : [],
        cree_par: session.member.personnel_notion_id ? [session.member.personnel_notion_id] : [],
        patient_lie: [input.patient],
        dossier_lie: [pageId],
        created_time: new Date().toISOString(),
      });
    } catch (e) {
      console.error("creerDossier: tâche de triage non créée", e);
    }

    await logAudit(session, { action: "create", area: "dossiers", targetId: pageId, targetLabel: ref });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Cycle de vie du compte rendu : À rédiger → À valider → Envoyé (+ date). */
export async function setStatutCR(dossierId: string, statut: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "dossiers_all") && !can(session, "dossiers_own")) return { ok: false, error: "Accès refusé" };
    const patch: Record<string, any> = { "Statut CR": P.select(statut) };
    const mirror: Record<string, unknown> = { statut_cr: statut };
    if (statut === "Envoyé") {
      const today = new Date().toISOString().slice(0, 10);
      patch["CR envoyé le"] = P.date(today);
      mirror.cr_envoye_le = today;
    }
    await notionUpdate(dossierId, patch);
    await supabaseAdmin().from("dossiers").update(mirror).eq("notion_id", dossierId);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setLienCR(dossierId: string, url: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "dossiers_all") && !can(session, "dossiers_own")) return { ok: false, error: "Accès refusé" };
    await notionUpdate(dossierId, { "Lien CR": P.url(url || null) });
    await supabaseAdmin().from("dossiers").update({ lien_cr: url || null }).eq("notion_id", dossierId);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setOrdonnanceRemise(dossierId: string, remise: boolean): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "dossiers_all") && !can(session, "dossiers_own")) return { ok: false, error: "Accès refusé" };
    await notionUpdate(dossierId, { "Ordonnance remise": P.checkbox(remise) });
    await supabaseAdmin().from("dossiers").update({ ordonnance_remise: remise }).eq("notion_id", dossierId);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ============================================================
// Tâches
// ============================================================

export async function creerTache(input: {
  titre: string;
  echeance?: string | null;
  priorite?: string | null;
  domaine?: string | null;
  calendrier?: string | null;
  recurrence?: string | null;
  responsable?: string | null; // personnel notion id
  patient?: string | null;
  dossier?: string | null;
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "taches")) return { ok: false, error: "Accès refusé" };
    if (!input.titre.trim()) return { ok: false, error: "Titre requis" };

    const admin = supabaseAdmin();

    // Décision de la réunion : sans responsable → Dr Amraoui (owner)
    let responsable = input.responsable ?? null;
    if (!responsable) {
      const { data: owner } = await admin
        .from("app_members")
        .select("personnel_notion_id")
        .eq("is_owner", true)
        .not("personnel_notion_id", "is", null)
        .limit(1)
        .maybeSingle();
      responsable = owner?.personnel_notion_id ?? null;
    }

    const props: Record<string, any> = {
      Titre: P.title(input.titre.trim()),
      Statut: P.select("À faire"),
      Calendrier: P.select(input.calendrier ?? "Ponctuelle"),
      Domaine: P.select(input.domaine ?? "Clinique"),
      Priorité: P.select(input.priorite ?? "Normale"),
    };
    if (input.echeance) props["Échéance"] = P.date(input.echeance);
    if (input.recurrence && input.calendrier === "Récurrente") props["Récurrence"] = P.select(input.recurrence);
    if (responsable) props["Responsable"] = P.relation([responsable]);
    if (session.member.personnel_notion_id) props["Créé par"] = P.relation([session.member.personnel_notion_id]);
    if (input.patient) props["Patient lié"] = P.relation([input.patient]);
    if (input.dossier) props["Dossier lié"] = P.relation([input.dossier]);

    const pageId = await notionCreate("taches", props);

    await admin.from("taches").insert({
      notion_id: pageId,
      titre: input.titre.trim(),
      statut: "À faire",
      calendrier: input.calendrier ?? "Ponctuelle",
      recurrence: input.calendrier === "Récurrente" ? input.recurrence ?? null : null,
      echeance: input.echeance ?? null,
      priorite: input.priorite ?? "Normale",
      domaine: input.domaine ?? "Clinique",
      responsable: responsable ? [responsable] : [],
      cree_par: session.member.personnel_notion_id ? [session.member.personnel_notion_id] : [],
      patient_lie: input.patient ? [input.patient] : [],
      dossier_lie: input.dossier ? [input.dossier] : [],
      created_time: new Date().toISOString(),
    });
    await logAudit(session, { action: "create", area: "taches", targetId: pageId, targetLabel: input.titre.trim() });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setStatutTache(tacheId: string, statut: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "taches")) return { ok: false, error: "Accès refusé" };
    await notionUpdate(tacheId, { Statut: P.select(statut) });
    await supabaseAdmin().from("taches").update({ statut }).eq("notion_id", tacheId);
    await logAudit(session, { action: "status", area: "taches", targetId: tacheId, detail: { statut } });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function reassignerTache(tacheId: string, personnelId: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "taches")) return { ok: false, error: "Accès refusé" };
    await notionUpdate(tacheId, { Responsable: P.relation([personnelId]) });
    await supabaseAdmin().from("taches").update({ responsable: [personnelId] }).eq("notion_id", tacheId);
    await logAudit(session, { action: "assign", area: "taches", targetId: tacheId, detail: { responsable: personnelId } });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** « Je m'en occupe » : la tâche du pool est réassignée au membre connecté. */
export async function prendreTache(tacheId: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "taches")) return { ok: false, error: "Accès refusé" };
    const me = session.member.personnel_notion_id;
    if (!me) return { ok: false, error: "Compte non relié à une fiche Personnel (voir Accès et comptes)" };
    await notionUpdate(tacheId, { Responsable: P.relation([me]) });
    await supabaseAdmin().from("taches").update({ responsable: [me] }).eq("notion_id", tacheId);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Suppression (admin/owner) : archive la page Notion + retire le miroir. */
export async function supprimerTache(tacheId: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session.member.is_owner && session.member.role !== "admin") {
      return { ok: false, error: "Accès refusé" };
    }
    await withNotionRetry(() => notion().pages.update({ page_id: tacheId, archived: true }));
    await supabaseAdmin().from("taches").delete().eq("notion_id", tacheId);
    await logAudit(session, { action: "delete", area: "taches", targetId: tacheId });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ============================================================
// Paiements
// ============================================================

export async function enregistrerPaiement(
  paiementId: string,
  input: { montant_paye: number; mode_paiement: string | null }
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "paiements_all")) return { ok: false, error: "Accès refusé" };

    const admin = supabaseAdmin();
    const { data: row } = await admin
      .from("paiements")
      .select("montant_du")
      .eq("notion_id", paiementId)
      .single();
    const du = Number(row?.montant_du ?? 0);
    const statut = input.montant_paye >= du && du > 0 ? "Payé" : input.montant_paye > 0 ? "Partiel" : "Impayé";

    const props: Record<string, any> = {
      "Montant payé": P.number(input.montant_paye),
      "Statut paiement": P.select(statut),
    };
    if (input.mode_paiement) props["Mode de paiement"] = P.select(input.mode_paiement);
    if (statut === "Payé") props["Suivi"] = P.select("Résolu");

    await notionUpdate(paiementId, props);
    await admin
      .from("paiements")
      .update({
        montant_paye: input.montant_paye,
        statut_paiement: statut,
        mode_paiement: input.mode_paiement,
        ...(statut === "Payé" ? { suivi: "Résolu" } : {}),
      })
      .eq("notion_id", paiementId);
    await logAudit(session, { action: "collect", area: "paiements", targetId: paiementId, detail: { montant_paye: input.montant_paye, statut } });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function creerPaiement(input: {
  patient: string;
  type_prestation: string;
  montant_du: number;
  montant_paye?: number;
  mode_paiement?: string | null;
  echeance?: string | null;
  responsable?: string | null; // médecin (personnel notion id)
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "paiements_all")) return { ok: false, error: "Accès refusé" };

    const paye = input.montant_paye ?? 0;
    const statut = paye >= input.montant_du && input.montant_du > 0 ? "Payé" : paye > 0 ? "Partiel" : "Impayé";
    const ref = `PAY-${Date.now().toString(36).toUpperCase()}`;

    const props: Record<string, any> = {
      "Réf paiement": P.title(ref),
      "Type de prestation": P.select(input.type_prestation),
      "Montant dû": P.number(input.montant_du),
      "Montant payé": P.number(paye),
      "Statut paiement": P.select(statut),
      Patient: P.relation([input.patient]),
    };
    if (input.mode_paiement) props["Mode de paiement"] = P.select(input.mode_paiement);
    if (input.echeance) props["Échéance"] = P.date(input.echeance);
    if (input.responsable) props["Responsable"] = P.relation([input.responsable]);

    const pageId = await notionCreate("paiements", props);

    await supabaseAdmin().from("paiements").insert({
      notion_id: pageId,
      ref_paiement: ref,
      type_prestation: input.type_prestation,
      montant_du: input.montant_du,
      montant_paye: paye,
      statut_paiement: statut,
      mode_paiement: input.mode_paiement ?? null,
      echeance: input.echeance ?? null,
      patient: [input.patient],
      responsable: input.responsable ? [input.responsable] : [],
      created_time: new Date().toISOString(),
    });
    await logAudit(session, { action: "create", area: "paiements", targetId: pageId, targetLabel: ref, detail: { montant_du: input.montant_du } });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ============================================================
// Examens / appareils
// ============================================================

/**
 * Pose d'un examen : choisit une unité LIBRE du parc (Appareils) ; l'unité
 * passe « Dehors » et reste liée à l'examen jusqu'au retour. La réf de l'unité
 * est copiée dans « Numéro appareil » (historique conservé après restitution).
 */
export async function creerExamen(input: {
  type: string;
  patient: string;
  appareil?: string | null; // notion id de l'unité choisie
  indication?: string | null;
  site?: string | null;
  date_pose: string;
  restitution_prevue?: string | null;
  interprete?: string | null;
  responsable?: string | null;
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "examens")) return { ok: false, error: "Accès refusé" };
    if (!input.patient) return { ok: false, error: "Patient requis" };

    const admin = supabaseAdmin();
    let uniteRef: string | null = null;
    if (input.appareil) {
      const { data: unite } = await admin
        .from("appareils")
        .select("ref_appareil, etat")
        .eq("notion_id", input.appareil)
        .single();
      if (!unite) return { ok: false, error: "Unité introuvable (synchronisation ?)" };
      if (unite.etat !== "Au cabinet") return { ok: false, error: `Unité indisponible (${unite.etat})` };
      uniteRef = unite.ref_appareil;
    }

    const ref = `EX-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
    const props: Record<string, any> = {
      "Réf examen": P.title(ref),
      Type: P.select(input.type),
      Patient: P.relation([input.patient]),
      "Date de pose": P.date(input.date_pose),
      "Statut appareil": P.select("Remis"),
    };
    if (input.appareil) props["Appareil"] = P.relation([input.appareil]);
    if (uniteRef) props["Numéro appareil"] = P.text(uniteRef);
    if (input.indication) props["Indication"] = P.select(input.indication);
    if (input.site) props["Site"] = P.select(input.site);
    if (input.restitution_prevue) props["Restitution prévue"] = P.date(input.restitution_prevue);
    if (input.interprete) props["Interprète"] = P.relation([input.interprete]);
    if (input.responsable) props["Responsable"] = P.relation([input.responsable]);

    const pageId = await notionCreate("examens", props);

    // L'unité sort du cabinet (la relation « Examen en cours » est déjà
    // synchronisée côté Notion — relation double —, on ne pousse que l'État).
    if (input.appareil) {
      await notionUpdate(input.appareil, { "État": P.select("Dehors") });
      await admin
        .from("appareils")
        .update({ etat: "Dehors", examen_en_cours: [pageId] })
        .eq("notion_id", input.appareil);
    }

    await admin.from("examens").insert({
      notion_id: pageId,
      ref_examen: ref,
      type: input.type,
      indication: input.indication ?? null,
      site: input.site ?? null,
      statut_appareil: "Remis",
      numero_appareil: uniteRef,
      date_pose: input.date_pose,
      restitution_prevue: input.restitution_prevue ?? null,
      patient: [input.patient],
      appareil: input.appareil ? [input.appareil] : [],
      interprete: input.interprete ? [input.interprete] : [],
      responsable: input.responsable ? [input.responsable] : [],
      created_time: new Date().toISOString(),
    });
    await logAudit(session, { action: "assign", area: "examens", targetId: pageId, targetLabel: ref, detail: { type: input.type } });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** « Marquer rendu » : l'examen est clos côté appareil et l'unité redevient libre. */
export async function appareilRendu(examenId: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "examens")) return { ok: false, error: "Accès refusé" };
    const today = new Date().toISOString().slice(0, 10);
    const admin = supabaseAdmin();

    const { data: exam } = await admin
      .from("examens")
      .select("appareil")
      .eq("notion_id", examenId)
      .single();

    await notionUpdate(examenId, {
      "Statut appareil": P.select("Rendu"),
      "Restitution effective": P.date(today),
      // libère l'unité (relation double : le côté Appareils suit)
      ...(exam?.appareil?.length ? { Appareil: P.relation([]) } : {}),
    });
    await admin
      .from("examens")
      .update({ statut_appareil: "Rendu", restitution_effective: today, appareil: [] })
      .eq("notion_id", examenId);

    for (const uniteId of exam?.appareil ?? []) {
      await notionUpdate(uniteId, { "État": P.select("Au cabinet") });
      await admin.from("appareils").update({ etat: "Au cabinet", examen_en_cours: [] }).eq("notion_id", uniteId);
    }
    await logAudit(session, { action: "return", area: "examens", targetId: examenId });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Ajoute une unité au parc (nouvel appareil physique acheté). Réf = "{Type} n°{Numéro}".
 * L'unité démarre « Au cabinet », libre.
 */
export async function creerAppareil(input: {
  type: string;
  numero?: string | null;
  date_achat?: string | null;
  notes?: string | null;
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    // Ajouter un appareil au parc = geste d'inventaire, réservé à l'administration.
    if (!session.member.is_owner && session.member.role !== "admin") {
      return { ok: false, error: "Réservé à l'administration" };
    }
    if (!input.type) return { ok: false, error: "Type requis" };

    const num = (input.numero ?? "").trim();
    const ref = num ? `${input.type} n°${num}` : input.type;

    const props: Record<string, any> = {
      "Réf": P.title(ref),
      Type: P.select(input.type),
      "État": P.select("Au cabinet"),
    };
    if (num) props["Numéro"] = P.text(num);
    if (input.date_achat) props["Date d'achat"] = P.date(input.date_achat);
    if (input.notes) props["Notes"] = P.text(input.notes);

    const pageId = await notionCreate("appareils", props);
    await supabaseAdmin().from("appareils").insert({
      notion_id: pageId,
      ref_appareil: ref,
      type: input.type,
      numero: num || null,
      etat: "Au cabinet",
      date_achat: input.date_achat ?? null,
      notes: input.notes ?? null,
      created_time: new Date().toISOString(),
    });
    await logAudit(session, { action: "create", area: "appareils", targetId: pageId, targetLabel: ref });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** État manuel d'une unité (Maintenance / Perdu / Réformé / Au cabinet). */
export async function setEtatAppareil(appareilId: string, etat: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "examens")) return { ok: false, error: "Accès refusé" };
    await notionUpdate(appareilId, { "État": P.select(etat) });
    await supabaseAdmin().from("appareils").update({ etat }).eq("notion_id", appareilId);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Interpréter un examen rendu : saisir les résultats, poser la date
 * d'interprétation (le sort de la file « à interpréter »), et la CAT si PPG.
 */
export async function interpreterExamen(
  examenId: string,
  input: { resultats?: string | null; conclusion?: string | null; cat?: string | null; clear?: boolean }
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "examens")) return { ok: false, error: "Accès refusé" };
    const today = new Date().toISOString().slice(0, 10);

    // « Effacer » : on retire l'interprétation → l'examen retourne dans la file.
    if (input.clear) {
      await notionUpdate(examenId, {
        "Résultats": P.text(null),
        "Conclusion": P.select(null),
        "CAT": P.select(null),
        "Date interprétation": P.date(null),
      });
      await supabaseAdmin()
        .from("examens")
        .update({ resultats: null, conclusion: null, cat: null, date_interpretation: null })
        .eq("notion_id", examenId);
      await logAudit(session, { action: "interpret", area: "examens", targetId: examenId, detail: { cleared: true } });
      refresh();
      return { ok: true };
    }

    await notionUpdate(examenId, {
      "Résultats": P.text(input.resultats ?? null),
      "Conclusion": P.select(input.conclusion ?? null),
      "CAT": P.select(input.cat ?? null),
      "Date interprétation": P.date(today),
    });
    await supabaseAdmin()
      .from("examens")
      .update({
        resultats: input.resultats ?? null,
        conclusion: input.conclusion ?? null,
        cat: input.cat ?? null,
        date_interpretation: today,
      })
      .eq("notion_id", examenId);
    await logAudit(session, { action: "interpret", area: "examens", targetId: examenId, detail: { conclusion: input.conclusion ?? null, cat: input.cat ?? null } });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Marquer le compte rendu de l'examen comme envoyé (date d'envoi = aujourd'hui). */
export async function envoyerExamen(examenId: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "examens")) return { ok: false, error: "Accès refusé" };
    const today = new Date().toISOString().slice(0, 10);
    await notionUpdate(examenId, { "Date envoi": P.date(today) });
    await supabaseAdmin().from("examens").update({ date_envoi: today }).eq("notion_id", examenId);
    await logAudit(session, { action: "send", area: "examens", targetId: examenId });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** CAT (conduite à tenir) après interprétation d'une polygraphie. */
export async function setCAT(examenId: string, cat: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "examens")) return { ok: false, error: "Accès refusé" };
    await notionUpdate(examenId, { CAT: P.select(cat) });
    await supabaseAdmin().from("examens").update({ cat }).eq("notion_id", examenId);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Suivi appareillage (CAT = PPC) : contact, société, pose, RDV de suite. */
export async function majAppareillage(
  examenId: string,
  input: {
    contacte: boolean;
    societe?: string | null;
    pose_le?: string | null;
    rdv_pgv?: string | null;
    rdv_pneumo?: string | null;
  }
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "examens")) return { ok: false, error: "Accès refusé" };
    await notionUpdate(examenId, {
      "Contacté pour appareillage": P.checkbox(input.contacte),
      "Société d'appareillage": P.select(input.societe ?? null),
      "Appareillage posé le": P.date(input.pose_le ?? null),
      "RDV suivi PGV": P.date(input.rdv_pgv ?? null),
      "RDV pneumologue": P.date(input.rdv_pneumo ?? null),
    });
    await supabaseAdmin()
      .from("examens")
      .update({
        contacte_appareillage: input.contacte,
        societe_appareillage: input.societe ?? null,
        appareillage_pose_le: input.pose_le ?? null,
        rdv_suivi_pgv: input.rdv_pgv ?? null,
        rdv_pneumologue: input.rdv_pneumo ?? null,
      })
      .eq("notion_id", examenId);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * « Facturer la pénalité » : montant CALCULÉ (jours de retard × tarif
 * Paramètres selon le type), décision humaine — crée la ligne Paiement.
 */
export async function facturerPenalite(examenId: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "paiements_all")) return { ok: false, error: "Accès refusé" };
    const admin = supabaseAdmin();

    const { data: exam } = await admin
      .from("examens")
      .select("ref_examen, type, restitution_prevue, restitution_effective, patient")
      .eq("notion_id", examenId)
      .single();
    if (!exam) return { ok: false, error: "Examen introuvable" };
    if (!exam.restitution_prevue) return { ok: false, error: "Pas de date de retour prévue" };

    const { data: params } = await admin
      .from("parametres")
      .select("parametre, valeur")
      .in("parametre", ["late_fee_holter", "late_fee_polygraphie"]);
    const rateMap = new Map((params ?? []).map((p) => [p.parametre, Number(p.valeur)]));
    const isPgv = (exam.type ?? "").includes("Polygraphie");
    const rate = rateMap.get(isPgv ? "late_fee_polygraphie" : "late_fee_holter") ?? (isPgv ? 100 : 150);

    const end = exam.restitution_effective ? new Date(exam.restitution_effective) : new Date();
    const due = new Date(exam.restitution_prevue);
    const days = Math.max(0, Math.floor((end.getTime() - due.getTime()) / 86_400_000));
    if (days === 0) return { ok: false, error: "Aucun jour de retard" };
    const montant = days * rate;

    const ref = `PAY-${Date.now().toString(36).toUpperCase()}`;
    const note = `Pénalité retard ${exam.ref_examen ?? ""} : ${days} j × ${rate} €`;
    const props: Record<string, any> = {
      "Réf paiement": P.title(ref),
      "Type de prestation": P.select("Pénalité retard"),
      "Montant dû": P.number(montant),
      "Montant payé": P.number(0),
      "Statut paiement": P.select("Impayé"),
      Notes: P.text(note),
      Examen: P.relation([examenId]),
    };
    if (exam.patient?.length) props["Patient"] = P.relation(exam.patient);

    const pageId = await notionCreate("paiements", props);
    await admin.from("paiements").insert({
      notion_id: pageId,
      ref_paiement: ref,
      type_prestation: "Pénalité retard",
      montant_du: montant,
      montant_paye: 0,
      statut_paiement: "Impayé",
      notes: note,
      patient: exam.patient ?? [],
      examen: [examenId],
      created_time: new Date().toISOString(),
    });
    await logAudit(session, { action: "penalty", area: "paiements", targetId: pageId, targetLabel: ref, detail: { days, rate, montant, examen: exam.ref_examen } });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ============================================================
// Patients
// ============================================================

export async function creerPatient(input: {
  prenom?: string | null;
  nom: string; // nom de famille
  date_naissance?: string | null;
  telephone?: string | null;
  email?: string | null;
  adresse?: string | null;
  notes_secretariat?: string | null;
  probleme_principal?: string | null;
  type_patient?: string | null;
  medecin?: string | null;
  lien_doctolib?: string | null;
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "patients_all")) return { ok: false, error: "Accès refusé" };
    const prenom = (input.prenom ?? "").trim();
    const last = input.nom.trim();
    if (!last) return { ok: false, error: "Nom requis" };
    const full = [prenom, last].filter(Boolean).join(" ");

    const props: Record<string, any> = {
      Nom: P.title(full),
      "Prénom": P.text(prenom || null),
      "Nom de famille": P.text(last),
      Statut: P.select("Actif"),
      "Type patient": P.select(input.type_patient ?? "Nouveau"),
    };
    if (input.date_naissance) props["Date de naissance"] = P.date(input.date_naissance);
    if (input.telephone) props["Téléphone"] = P.phone(input.telephone);
    if (input.email) props["Email"] = P.email(input.email);
    if (input.adresse) props["Adresse"] = P.text(input.adresse);
    if (input.notes_secretariat) props["Notes secrétariat"] = P.text(input.notes_secretariat);
    if (input.probleme_principal) props["Problème principal"] = P.select(input.probleme_principal);
    if (input.medecin) props["Médecin assigné"] = P.relation([input.medecin]);
    if (input.lien_doctolib) props["Lien Doctolib"] = P.url(input.lien_doctolib);

    const pageId = await notionCreate("patients", props);

    await supabaseAdmin().from("patients").insert({
      notion_id: pageId,
      nom: full,
      prenom: prenom || null,
      nom_famille: last,
      statut: "Actif",
      type_patient: input.type_patient ?? "Nouveau",
      date_naissance: input.date_naissance ?? null,
      telephone: input.telephone ?? null,
      email: input.email ?? null,
      adresse: input.adresse ?? null,
      notes_secretariat: input.notes_secretariat ?? null,
      probleme_principal: input.probleme_principal ?? null,
      lien_doctolib: input.lien_doctolib ?? null,
      medecin_assigne: input.medecin ? [input.medecin] : [],
      created_time: new Date().toISOString(),
    });
    await logAudit(session, { action: "create", area: "patients", targetId: pageId, targetLabel: full });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Fiche patient : état civil et notes non cliniques, modifiables au détail. */
export async function majPatientInfos(
  patientId: string,
  input: {
    prenom?: string | null;
    nom?: string | null; // nom de famille
    date_naissance?: string | null;
    telephone?: string | null;
    email?: string | null;
    adresse?: string | null;
    notes_secretariat?: string | null;
  }
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "patients_all")) return { ok: false, error: "Accès refusé" };
    // Nom composé recalculé quand prénom/nom sont fournis (édition du détail).
    const editName = input.prenom !== undefined || input.nom !== undefined;
    const prenom = (input.prenom ?? "").trim();
    const last = (input.nom ?? "").trim();
    const full = [prenom, last].filter(Boolean).join(" ");
    const namePatch = editName && last
      ? { Nom: P.title(full), "Prénom": P.text(prenom || null), "Nom de famille": P.text(last) }
      : {};
    await notionUpdate(patientId, {
      ...namePatch,
      "Date de naissance": P.date(input.date_naissance ?? null),
      "Téléphone": P.phone(input.telephone ?? null),
      "Email": P.email(input.email ?? null),
      "Adresse": P.text(input.adresse ?? null),
      "Notes secrétariat": P.text(input.notes_secretariat ?? null),
    });
    await supabaseAdmin()
      .from("patients")
      .update({
        ...(editName && last ? { nom: full, prenom: prenom || null, nom_famille: last } : {}),
        date_naissance: input.date_naissance || null,
        telephone: input.telephone || null,
        email: input.email || null,
        adresse: input.adresse || null,
        notes_secretariat: input.notes_secretariat || null,
      })
      .eq("notion_id", patientId);
    await logAudit(session, { action: "update", area: "patients", targetId: patientId });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ============================================================
// Perfusions
// ============================================================

/**
 * « Nouvelle perfusion » (S19) : la séance est enregistrée et sa facturation
 * (forfait + honoraire IPA) est créée dans Paiements en une fois.
 */
export async function creerPerfusion(input: {
  patient: string;
  date_perfusion: string;
  composants?: string | null;
  duree?: string | null;
  bilan_bio?: string | null;
  honoraire_ipa?: number | null;
  forfait?: number | null; // montant facturé au patient (350-400 €)
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "perfusions")) return { ok: false, error: "Accès refusé" };
    if (!input.patient) return { ok: false, error: "Patient requis" };

    const admin = supabaseAdmin();
    const ref = `PERF-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;

    const props: Record<string, any> = {
      "Réf perfusion": P.title(ref),
      "Date de perfusion": P.date(input.date_perfusion),
      Patient: P.relation([input.patient]),
    };
    if (input.composants) props["Composants"] = P.text(input.composants);
    if (input.duree) props["Durée"] = P.text(input.duree);
    if (input.bilan_bio) props["Bilan bio"] = P.select(input.bilan_bio);
    if (input.honoraire_ipa != null) props["Honoraire IPA"] = P.number(input.honoraire_ipa);

    const perfusionId = await notionCreate("perfusions", props);
    await admin.from("perfusions").insert({
      notion_id: perfusionId,
      ref_perfusion: ref,
      date_perfusion: input.date_perfusion,
      composants: input.composants ?? null,
      duree: input.duree ?? null,
      bilan_bio: input.bilan_bio ?? null,
      honoraire_ipa: input.honoraire_ipa ?? null,
      patient: [input.patient],
      created_time: new Date().toISOString(),
    });

    // Facturation liée (le forfait patient inclut la séance ; l'hono IPA est noté)
    if (input.forfait && input.forfait > 0) {
      const refPay = `PAY-${Date.now().toString(36).toUpperCase()}`;
      const payProps: Record<string, any> = {
        "Réf paiement": P.title(refPay),
        "Type de prestation": P.select("Perfusion nutrition"),
        "Montant dû": P.number(input.forfait),
        "Montant payé": P.number(0),
        "Statut paiement": P.select("Impayé"),
        Patient: P.relation([input.patient]),
        Perfusion: P.relation([perfusionId]),
      };
      if (input.honoraire_ipa != null) payProps["Notes"] = P.text(`Hono IPA : ${input.honoraire_ipa} €`);
      const payId = await notionCreate("paiements", payProps);
      await admin.from("paiements").insert({
        notion_id: payId,
        ref_paiement: refPay,
        type_prestation: "Perfusion nutrition",
        montant_du: input.forfait,
        montant_paye: 0,
        statut_paiement: "Impayé",
        notes: input.honoraire_ipa != null ? `Hono IPA : ${input.honoraire_ipa} €` : null,
        patient: [input.patient],
        perfusion: [perfusionId],
        created_time: new Date().toISOString(),
      });
      // lien retour Perfusion → Paiement
      await notionUpdate(perfusionId, { Paiement: P.relation([payId]) });
      await admin.from("perfusions").update({ paiement: [payId] }).eq("notion_id", perfusionId);
    }
    await logAudit(session, { action: "create", area: "perfusions", targetId: perfusionId, targetLabel: ref });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Édition d'une séance de perfusion enregistrée (rien n'est figé). */
export async function majPerfusion(
  perfusionId: string,
  input: {
    date_perfusion?: string | null;
    composants?: string | null;
    duree?: string | null;
    bilan_bio?: string | null;
    honoraire_ipa?: number | null;
    notes?: string | null;
  }
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "perfusions")) return { ok: false, error: "Accès refusé" };
    await notionUpdate(perfusionId, {
      "Date de perfusion": P.date(input.date_perfusion ?? null),
      "Composants": P.text(input.composants ?? null),
      "Durée": P.text(input.duree ?? null),
      "Bilan bio": P.select(input.bilan_bio ?? null),
      "Honoraire IPA": P.number(input.honoraire_ipa ?? null),
      "Notes": P.text(input.notes ?? null),
    });
    await supabaseAdmin()
      .from("perfusions")
      .update({
        date_perfusion: input.date_perfusion || null,
        composants: input.composants || null,
        duree: input.duree || null,
        bilan_bio: input.bilan_bio || null,
        honoraire_ipa: input.honoraire_ipa ?? null,
        notes: input.notes || null,
      })
      .eq("notion_id", perfusionId);
    await logAudit(session, { action: "update", area: "perfusions", targetId: perfusionId });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ============================================================
// Inventaire (consommables) — le journal des mouvements fait foi
// ============================================================

/** Nouvel article au stock. Réservé à l'administration (décision 8 juil.). */
export async function creerArticle(input: {
  article: string;
  categorie?: string | null;
  quantite?: number | null;
  unite?: string | null;
  seuil_minimum?: number | null;
  fournisseur?: string | null;
  notes?: string | null;
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session.member.is_owner && session.member.role !== "admin") {
      return { ok: false, error: "Réservé à l'administration" };
    }
    if (!input.article.trim()) return { ok: false, error: "Nom requis" };

    const qty = Math.max(0, input.quantite ?? 0);
    const props: Record<string, any> = {
      Article: P.title(input.article.trim()),
      "Quantité": P.number(qty),
      "Seuil minimum": P.number(input.seuil_minimum ?? 0),
    };
    if (input.categorie) props["Catégorie"] = P.select(input.categorie);
    if (input.unite) props["Unité"] = P.select(input.unite);
    if (input.fournisseur) props["Fournisseur"] = P.text(input.fournisseur);
    if (input.notes) props["Notes"] = P.text(input.notes);

    const pageId = await notionCreate("stock", props);
    await supabaseAdmin().from("stock").insert({
      notion_id: pageId,
      article: input.article.trim(),
      categorie: input.categorie ?? null,
      quantite: qty,
      unite: input.unite ?? null,
      seuil_minimum: input.seuil_minimum ?? 0,
      fournisseur: input.fournisseur ?? null,
      notes: input.notes ?? null,
      created_time: new Date().toISOString(),
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Mouvement de stock (Entrée = réappro / Sortie = utilisation) : écrit la
 * ligne du journal ET met à jour la quantité de l'article. La quantité ne
 * descend jamais sous zéro.
 */
export async function mouvementStock(
  articleId: string,
  input: { sens: "Entrée" | "Sortie"; quantite: number; motif?: string | null; par?: string | null }
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "stock")) return { ok: false, error: "Accès refusé" };
    const qte = Math.floor(input.quantite);
    if (!qte || qte <= 0) return { ok: false, error: "Quantité invalide" };

    // Qui a fait le mouvement : la personne choisie dans le formulaire (responsabilité),
    // sinon la fiche Personnel liée au compte connecté.
    const par = input.par || session.member.personnel_notion_id || null;

    const admin = supabaseAdmin();
    const { data: art } = await admin
      .from("stock")
      .select("article, quantite")
      .eq("notion_id", articleId)
      .single();
    if (!art) return { ok: false, error: "Article introuvable (synchronisation ?)" };

    const current = Number(art.quantite ?? 0);
    const next = input.sens === "Entrée" ? current + qte : current - qte;
    if (next < 0) return { ok: false, error: "Stock insuffisant pour cette sortie" };

    const today = new Date().toISOString().slice(0, 10);
    const ref = `MV-${Date.now().toString(36).toUpperCase()}`;

    // 1. La ligne du journal
    const mvProps: Record<string, any> = {
      "Réf": P.title(ref),
      Article: P.relation([articleId]),
      Sens: P.select(input.sens),
      "Quantité": P.number(qte),
      Date: P.date(today),
    };
    if (input.motif) mvProps["Motif"] = P.text(input.motif);
    if (par) mvProps["Par"] = P.relation([par]);
    const mvId = await notionCreate("stock_mouvements", mvProps);

    // 2. La quantité de l'article (+ date de réappro sur une entrée)
    const artPatch: Record<string, any> = { "Quantité": P.number(next) };
    if (input.sens === "Entrée") artPatch["Dernier réappro"] = P.date(today);
    await notionUpdate(articleId, artPatch);

    await admin.from("stock_mouvements").insert({
      notion_id: mvId,
      ref_mouvement: ref,
      article: [articleId],
      sens: input.sens,
      quantite: qte,
      motif: input.motif ?? null,
      par: par ? [par] : [],
      date_mouvement: today,
      created_time: new Date().toISOString(),
    });
    await admin
      .from("stock")
      .update({ quantite: next, ...(input.sens === "Entrée" ? { dernier_reappro: today } : {}) })
      .eq("notion_id", articleId);
    await logAudit(session, { action: "stock_move", area: "stock", targetId: articleId, targetLabel: art.article, detail: { sens: input.sens, quantite: qte, par, motif: input.motif ?? null } });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Ajuste le seuil minimum d'un article. */
export async function setSeuilArticle(articleId: string, seuil: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "stock")) return { ok: false, error: "Accès refusé" };
    const s = Math.max(0, Math.floor(seuil));
    await notionUpdate(articleId, { "Seuil minimum": P.number(s) });
    await supabaseAdmin().from("stock").update({ seuil_minimum: s }).eq("notion_id", articleId);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ============================================================
// Paramètres (tarifs, offsets — édités par l'administration)
// ============================================================

export async function setParametre(parametreId: string, valeur: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session.member.is_owner && session.member.role !== "admin") {
      return { ok: false, error: "Accès refusé" };
    }
    await notionUpdate(parametreId, { Valeur: P.text(valeur) });
    await supabaseAdmin().from("parametres").update({ valeur }).eq("notion_id", parametreId);
    await logAudit(session, { action: "setting", area: "parametres", targetId: parametreId, detail: { valeur } });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function assignerMedecin(patientId: string, personnelId: string | null): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "patients_all")) return { ok: false, error: "Accès refusé" };
    await notionUpdate(patientId, { "Médecin assigné": P.relation(personnelId ? [personnelId] : []) });
    await supabaseAdmin()
      .from("patients")
      .update({ medecin_assigne: personnelId ? [personnelId] : [] })
      .eq("notion_id", patientId);
    await logAudit(session, { action: "assign", area: "patients", targetId: patientId, detail: { medecin: personnelId } });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
