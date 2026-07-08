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
  for (const p of ["/secretariat", "/medecin", "/patients", "/taches", "/finances", "/admin", "/examens", "/perfusions", "/appareils", "/dossiers"]) {
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
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "dossiers_all") && !input.dossier_parent) return { ok: false, error: "Accès refusé" };
    // Un médecin peut créer un dossier de suite pour ses patients (référence)
    if (!can(session, "dossiers_all") && !can(session, "dossiers_own")) return { ok: false, error: "Accès refusé" };
    if (!input.patient) return { ok: false, error: "Patient requis" };
    if (!input.motif) return { ok: false, error: "Motif requis" };

    const ref = `DOS-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;

    const props: Record<string, any> = {
      "ID Dossier": P.title(ref),
      Patient: P.relation([input.patient]),
      Motif: P.select(input.motif),
      "Statut intake": P.select("Nouveau"),
      "Revue secrétaire": P.multi(["À faire"]),
      "Statut médecin": P.select("Non visible"),
      "Visible médecin": P.checkbox(false),
      Priorité: P.select(input.priorite ?? "Normale"),
    };
    if (input.source) props["Source"] = P.select(input.source);
    if (input.site) props["Site"] = P.select(input.site);
    if (input.rendez_vous) props["Rendez-vous"] = P.date(input.rendez_vous);
    if (input.resume) props["Résumé motif"] = P.text(input.resume);
    if (input.medecin) props["Médecin assigné"] = P.relation([input.medecin]);
    if (input.dossier_parent) props["Dossier parent"] = P.relation([input.dossier_parent]);

    const pageId = await notionCreate("dossiers", props);

    await supabaseAdmin().from("dossiers").insert({
      notion_id: pageId,
      id_dossier: ref,
      patient: [input.patient],
      motif: input.motif,
      source: input.source ?? null,
      site: input.site ?? null,
      rendez_vous: input.rendez_vous ?? null,
      resume_motif: input.resume ?? null,
      priorite: input.priorite ?? "Normale",
      statut_intake: "Nouveau",
      revue_secretaire: ["À faire"],
      statut_medecin: "Non visible",
      visible_medecin: false,
      medecin_assigne: input.medecin ? [input.medecin] : [],
      dossier_parent: input.dossier_parent ? [input.dossier_parent] : [],
      created_time: new Date().toISOString(),
    });
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
  nom: string;
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
    if (!input.nom.trim()) return { ok: false, error: "Nom requis" };

    const props: Record<string, any> = {
      Nom: P.title(input.nom.trim()),
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
      nom: input.nom.trim(),
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
    await notionUpdate(patientId, {
      "Date de naissance": P.date(input.date_naissance ?? null),
      "Téléphone": P.phone(input.telephone ?? null),
      "Email": P.email(input.email ?? null),
      "Adresse": P.text(input.adresse ?? null),
      "Notes secrétariat": P.text(input.notes_secretariat ?? null),
    });
    await supabaseAdmin()
      .from("patients")
      .update({
        date_naissance: input.date_naissance || null,
        telephone: input.telephone || null,
        email: input.email || null,
        adresse: input.adresse || null,
        notes_secretariat: input.notes_secretariat || null,
      })
      .eq("notion_id", patientId);
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
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
