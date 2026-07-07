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
  for (const p of ["/secretariat", "/medecin", "/patients", "/taches", "/finances", "/admin", "/examens", "/perfusions"]) {
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

export async function appareilRendu(examenId: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "examens")) return { ok: false, error: "Accès refusé" };
    const today = new Date().toISOString().slice(0, 10);
    await notionUpdate(examenId, {
      "Statut appareil": P.select("Rendu"),
      "Restitution effective": P.date(today),
    });
    await supabaseAdmin()
      .from("examens")
      .update({ statut_appareil: "Rendu", restitution_effective: today })
      .eq("notion_id", examenId);
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
  telephone?: string | null;
  email?: string | null;
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
    if (input.telephone) props["Téléphone"] = P.phone(input.telephone);
    if (input.email) props["Email"] = P.email(input.email);
    if (input.probleme_principal) props["Problème principal"] = P.select(input.probleme_principal);
    if (input.medecin) props["Médecin assigné"] = P.relation([input.medecin]);
    if (input.lien_doctolib) props["Lien Doctolib"] = P.url(input.lien_doctolib);

    const pageId = await notionCreate("patients", props);

    await supabaseAdmin().from("patients").insert({
      notion_id: pageId,
      nom: input.nom.trim(),
      statut: "Actif",
      type_patient: input.type_patient ?? "Nouveau",
      telephone: input.telephone ?? null,
      email: input.email ?? null,
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
