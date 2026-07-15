"use server";

/**
 * Écritures : Notion d'abord (source de vérité), puis miroir Supabase
 * optimiste pour que l'UI soit à jour immédiatement.
 * Toutes les actions vérifient la session + permission.
 */

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSession, can } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { P, notionCreate, notionUpdate, notionArchive } from "@/lib/notion/write";
import { isValidRange, isoWeek, addDays } from "@/lib/horaires";
import { estRecurrente } from "@/lib/recurrence";
import { genererInstanceSuivante } from "@/lib/taches-recurrence";
import { jour, uniteDisponible, prochaineDisponibilite } from "@/lib/appareils";
import { ETAT_APPAREIL_UNITE } from "@/lib/labels";
import { randomUUID } from "node:crypto";

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  categorie?: string | null;
  calendrier?: string | null;
  recurrence?: string | null;
  note?: string | null;
  responsable?: string | null; // personnel notion id
  patient?: string | null;
  dossier?: string | null;
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "taches")) return { ok: false, error: "Accès refusé" };
    if (!input.titre.trim()) return { ok: false, error: "Titre requis" };

    // Une tâche récurrente sans échéance n'a pas de motif : le motif EST l'échéance.
    const recurrente = estRecurrente(input.calendrier ?? null, input.recurrence ?? null);
    if (recurrente && !input.echeance) {
      return { ok: false, error: "Une tâche récurrente doit avoir une échéance (elle porte le motif)" };
    }

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

    // Notifier l'assigné par email (B3) quand la tâche est confiée à QUELQU'UN D'AUTRE.
    const notify = !!(responsable && responsable !== session.member.personnel_notion_id);

    // Chaîne d'instances d'une série récurrente (idempotence du générateur).
    const groupId = recurrente ? randomUUID() : null;

    const props: Record<string, any> = {
      Titre: P.title(input.titre.trim()),
      Statut: P.select("À faire"),
      Calendrier: P.select(input.calendrier ?? "Ponctuelle"),
      Domaine: P.select(input.domaine ?? "Clinique"),
      Priorité: P.select(input.priorite ?? "Normale"),
    };
    if (input.echeance) props["Échéance"] = P.date(input.echeance);
    if (recurrente) props["Récurrence"] = P.select(input.recurrence!);
    if (input.categorie) props["Catégorie"] = P.select(input.categorie);
    if (groupId) props["Groupe récurrence"] = P.text(groupId);
    if (input.note) props["Note"] = P.text(input.note);
    if (responsable) props["Responsable"] = P.relation([responsable]);
    if (notify) props["Notifier"] = P.checkbox(true);
    if (session.member.personnel_notion_id) props["Créé par"] = P.relation([session.member.personnel_notion_id]);
    if (input.patient) props["Patient lié"] = P.relation([input.patient]);
    if (input.dossier) props["Dossier lié"] = P.relation([input.dossier]);

    const pageId = await notionCreate("taches", props);

    await admin.from("taches").insert({
      notion_id: pageId,
      titre: input.titre.trim(),
      statut: "À faire",
      calendrier: input.calendrier ?? "Ponctuelle",
      recurrence: recurrente ? input.recurrence ?? null : null,
      recurring_group_id: groupId,
      echeance: input.echeance ?? null,
      priorite: input.priorite ?? "Normale",
      domaine: input.domaine ?? "Clinique",
      categorie: input.categorie ?? null,
      note: input.note ?? null,
      notifier: notify,
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

/**
 * `suivanteId` = l'instance engendrée par cette clôture, s'il y en a une. Le client en a
 * besoin pour que « Annuler » puisse la retirer (cf. annulerTerminee) : sans ça, annuler
 * rouvrait la tâche en laissant la suivante — deux tâches ouvertes de la même série.
 */
export async function setStatutTache(
  tacheId: string,
  statut: string
): Promise<{ ok: true; suivanteId?: string } | { ok: false; error: string }> {
  try {
    const session = await getSession();
    if (!can(session, "taches")) return { ok: false, error: "Accès refusé" };
    await notionUpdate(tacheId, { Statut: P.select(statut) });
    await supabaseAdmin().from("taches").update({ statut }).eq("notion_id", tacheId);
    await logAudit(session, { action: "status", area: "taches", targetId: tacheId, detail: { statut } });

    // Clôturer une instance récurrente engendre la suivante. Fait ICI, dans la MÊME action :
    // Next 16 sérialise les server actions d'un client, deux actions séparées ne se
    // recouvriraient donc pas — et « terminé » sans « suivante » romprait la série.
    //
    // Isolé dans son propre try : la tâche est DÉJÀ marquée terminée côté Notion et
    // Supabase. Laisser remonter l'erreur afficherait « échec » sur une clôture réussie.
    // Le filet du cron (rattraperRecurrences, toutes les 2 h) réparera la série.
    let suivanteId: string | undefined;
    if (statut === "Terminé") {
      try {
        const suivante = await genererInstanceSuivante(tacheId);
        if (suivante) {
          suivanteId = suivante.pageId;
          await logAudit(session, {
            action: "create",
            area: "taches",
            targetId: suivante.pageId,
            detail: { recurrence: "instance suivante", echeance: suivante.echeance, groupe: suivante.groupId },
          });
        }
      } catch {
        // best-effort : le cron rattrapera
      }
    }

    refresh();
    return { ok: true, suivanteId };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Annule une clôture (bouton « Annuler » du toast).
 *
 * Rouvrir la tâche ne suffit PAS : si elle était récurrente, `setStatutTache` vient
 * d'engendrer l'instance suivante. La laisser en place donnerait deux tâches ouvertes de la
 * même série — l'annulation n'annulait donc qu'à moitié.
 *
 * Les deux effets sont défaits ici, dans UNE action : Next 16 sérialise les server actions
 * d'un même client, deux appels séparés ne se recouvriraient pas.
 */
export async function annulerTerminee(
  tacheId: string,
  statutPrecedent: string,
  suivanteId?: string | null
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "taches")) return { ok: false, error: "Accès refusé" };

    await notionUpdate(tacheId, { Statut: P.select(statutPrecedent) });
    await supabaseAdmin().from("taches").update({ statut: statutPrecedent }).eq("notion_id", tacheId);
    await logAudit(session, {
      action: "status",
      area: "taches",
      targetId: tacheId,
      detail: { statut: statutPrecedent, annulation: true },
    });

    if (suivanteId) {
      // Prudent à dessein : on ne retire que l'instance engendrée à l'instant, et seulement
      // si personne n'y a touché entre-temps (toujours « À faire »). Best-effort — une
      // instance de trop se corrige à la main, une clôture rouverte de force, non.
      try {
        const admin = supabaseAdmin();
        const { data: suivante } = await admin
          .from("taches")
          .select("notion_id, statut")
          .eq("notion_id", suivanteId)
          .maybeSingle();
        if (suivante && suivante.statut === "À faire") {
          await notionArchive(suivanteId);
          await admin.from("taches").delete().eq("notion_id", suivanteId);
          await logAudit(session, {
            action: "delete",
            area: "taches",
            targetId: suivanteId,
            detail: { recurrence: "instance suivante annulée" },
          });
        }
      } catch {
        // best-effort
      }
    }

    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Arrête la récurrence : plus aucune instance ne sera engendrée.
 *
 * Le générateur repart toujours de l'instance la PLUS RÉCENTE du groupe (cf.
 * rattraperRecurrences). Arrêter revient donc à faire repasser cette dernière en
 * « Ponctuelle » — pas seulement celle sur laquelle on a cliqué, qui peut être une
 * ancienne instance déjà clôturée. Sans ça, le filet du cron ressusciterait la série.
 *
 * L'écriture va dans NOTION (source de vérité des tâches) avant le miroir Supabase :
 * un correctif Supabase seul serait écrasé au prochain pull, et la série repartirait.
 */
export async function arreterRecurrence(tacheId: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "taches")) return { ok: false, error: "Accès refusé" };
    const admin = supabaseAdmin();

    const { data: cible } = await admin
      .from("taches")
      .select("notion_id, recurring_group_id")
      .eq("notion_id", tacheId)
      .maybeSingle();

    // La cible cliquée + la plus récente du groupe (souvent la même).
    const aArreter = new Set<string>([tacheId]);
    if (cible?.recurring_group_id) {
      const { data: derniere } = await admin
        .from("taches")
        .select("notion_id")
        .eq("recurring_group_id", cible.recurring_group_id)
        .order("echeance", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (derniere?.notion_id) aArreter.add(derniere.notion_id);
    }

    for (const id of aArreter) {
      await notionUpdate(id, { Calendrier: P.select("Ponctuelle"), "Récurrence": P.select(null) });
      await admin.from("taches").update({ calendrier: "Ponctuelle", recurrence: null }).eq("notion_id", id);
    }

    await logAudit(session, {
      action: "update",
      area: "taches",
      targetId: tacheId,
      detail: { recurrence: "arrêtée", instances: aArreter.size },
    });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Édition d'une tâche (titre, échéance, priorité, catégorie, note) — rien n'est figé. */
export async function majTache(
  tacheId: string,
  input: {
    titre?: string | null;
    echeance?: string | null;
    priorite?: string | null;
    categorie?: string | null;
    note?: string | null;
  }
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "taches")) return { ok: false, error: "Accès refusé" };
    const patch: Record<string, any> = {
      "Échéance": P.date(input.echeance ?? null),
      "Priorité": P.select(input.priorite ?? "Normale"),
      "Catégorie": P.select(input.categorie || null),
      "Note": P.text(input.note ?? null),
    };
    if (input.titre && input.titre.trim()) patch["Titre"] = P.title(input.titre.trim());
    await notionUpdate(tacheId, patch);
    await supabaseAdmin()
      .from("taches")
      .update({
        ...(input.titre && input.titre.trim() ? { titre: input.titre.trim() } : {}),
        echeance: input.echeance || null,
        priorite: input.priorite ?? "Normale",
        categorie: input.categorie || null,
        note: input.note || null,
      })
      .eq("notion_id", tacheId);
    await logAudit(session, { action: "update", area: "taches", targetId: tacheId });
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
    // Confiée à quelqu'un d'autre → on (re)notifie : Notifier=on + on efface « Notifié le ».
    const notify = personnelId !== session.member.personnel_notion_id;
    const patch: Record<string, any> = { Responsable: P.relation([personnelId]) };
    if (notify) { patch["Notifier"] = P.checkbox(true); patch["Notifié le"] = P.date(null); }
    await notionUpdate(tacheId, patch);
    await supabaseAdmin()
      .from("taches")
      .update({ responsable: [personnelId], ...(notify ? { notifier: true, notifie_le: null } : {}) })
      .eq("notion_id", tacheId);
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
    await notionArchive(tacheId);
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
 * Pose (ou RÉSERVATION) d'un examen.
 *
 * Une réservation n'est rien d'autre qu'un examen dont la « Date de pose » est à venir :
 * pas de nouvelle entité. La disponibilité se juge sur la PLAGE demandée, pas sur l'état
 * courant de l'unité — c'est ce qui permet le cas de la réunion : appareil attendu le 6,
 * on réserve dès aujourd'hui pour le 7.
 *
 * L'unité ne passe « Dehors » que le jour de la pose : la réserver pour dans trois mois
 * ne doit pas l'immobiliser aujourd'hui (c'était le comportement précédent).
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
    const today = new Date().toISOString().slice(0, 10);
    const posee = jour(input.date_pose)!;
    // La pose est-elle à venir ? Alors c'est une réservation : l'unité reste au cabinet.
    const estReservation = posee > today;

    let uniteRef: string | null = null;
    if (input.appareil) {
      // Sans retour prévu, la fin du prêt est inconnue : plus aucun chevauchement
      // n'est calculable et l'unité serait bloquée indéfiniment pour les suivants.
      if (!input.restitution_prevue) {
        return { ok: false, error: "Retour prévu requis pour immobiliser un appareil" };
      }
      if (jour(input.restitution_prevue)! < posee) {
        return { ok: false, error: "Le retour prévu ne peut pas précéder la pose" };
      }

      const { data: unite } = await admin
        .from("appareils")
        .select("ref_appareil, etat")
        .eq("notion_id", input.appareil)
        .single();
      if (!unite) return { ok: false, error: "Unité introuvable (synchronisation ?)" };

      // Hors service : aucune date n'y changera rien.
      if (unite.etat && !["Au cabinet", "Dehors"].includes(unite.etat)) {
        return { ok: false, error: `Unité indisponible (${unite.etat})` };
      }

      // Disponibilité par PLAGE : les prêts ouverts de cette unité (pose passée
      // comme à venir) sont confrontés à la date demandée.
      const { data: prets } = await admin
        .from("examens")
        .select("notion_id, date_pose, restitution_prevue, restitution_effective")
        .contains("appareil", [input.appareil])
        .is("restitution_effective", null);

      const ouverts = (prets ?? []).map((e) => ({
        id: e.notion_id,
        debut: e.date_pose ?? today,
        retourPrevu: e.restitution_prevue,
        retourEffectif: e.restitution_effective,
      }));

      const rendue = jour(input.restitution_prevue);
      if (!uniteDisponible(ouverts, posee, rendue, today)) {
        const libre = prochaineDisponibilite(ouverts, posee, rendue, today);
        return {
          ok: false,
          error: libre
            ? `Unité indisponible à cette date — libre à partir du ${libre}`
            : "Unité indisponible : un prêt en cours n'a pas de date de retour",
        };
      }
      uniteRef = unite.ref_appareil;
    }

    const ref = `EX-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
    const statutAppareil = estReservation ? "Disponible" : "Remis";
    const props: Record<string, any> = {
      "Réf examen": P.title(ref),
      Type: P.select(input.type),
      Patient: P.relation([input.patient]),
      "Date de pose": P.date(input.date_pose),
      "Statut appareil": P.select(statutAppareil),
    };
    if (input.appareil) props["Appareil"] = P.relation([input.appareil]);
    if (uniteRef) props["Numéro appareil"] = P.text(uniteRef);
    if (input.indication) props["Indication"] = P.select(input.indication);
    if (input.site) props["Site"] = P.select(input.site);
    if (input.restitution_prevue) props["Restitution prévue"] = P.date(input.restitution_prevue);
    if (input.interprete) props["Interprète"] = P.relation([input.interprete]);
    if (input.responsable) props["Responsable"] = P.relation([input.responsable]);

    const pageId = await notionCreate("examens", props);

    // L'unité ne sort QUE si la pose est aujourd'hui : une réservation pour plus tard
    // la laisse au cabinet et disponible entre-temps (la relation « Examen en cours »
    // est déjà synchronisée côté Notion — relation double —, on ne pousse que l'État).
    if (input.appareil && !estReservation) {
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
      statut_appareil: statutAppareil,
      numero_appareil: uniteRef,
      date_pose: input.date_pose,
      restitution_prevue: input.restitution_prevue ?? null,
      patient: [input.patient],
      appareil: input.appareil ? [input.appareil] : [],
      interprete: input.interprete ? [input.interprete] : [],
      responsable: input.responsable ? [input.responsable] : [],
      created_time: new Date().toISOString(),
    });
    await logAudit(session, {
      action: estReservation ? "reserve" : "assign",
      area: "examens",
      targetId: pageId,
      targetLabel: ref,
      detail: { type: input.type, date_pose: posee, reservation: estReservation },
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
/** Les états physiques d'une unité. Source unique : la table de tons de `labels.ts`. */
const ETATS_UNITE = Object.keys(ETAT_APPAREIL_UNITE);
/** Ceux qui sortent l'unité du circuit : plus aucun sélecteur ne la propose. */
const ETATS_HORS_SERVICE = ["Maintenance", "Perdu", "Réformé"];

export async function setEtatAppareil(appareilId: string, etat: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "examens")) return { ok: false, error: "Accès refusé" };

    // Liste blanche. Une valeur libre ferait créer l'option par Notion, et tout le code
    // traite « ni Au cabinet ni Dehors » comme hors service : l'unité disparaîtrait de
    // TOUS les sélecteurs, définitivement, sans le moindre message. Le garde-fou existant
    // est côté client (`disabled`) — or une server action se joint en POST direct.
    if (!ETATS_UNITE.includes(etat)) return { ok: false, error: `État inconnu : ${etat}` };

    // Mettre hors service une unité qui porte un prêt ouvert ou une réservation à venir
    // ferait échouer l'activation EN SILENCE (activerReservationsDues saute le hors
    // service) : le patient se présente, l'appareil n'est pas là, personne n'a été prévenu.
    // On refuse et on dit quoi faire.
    if (ETATS_HORS_SERVICE.includes(etat)) {
      const { data: engages } = await supabaseAdmin()
        .from("examens")
        .select("notion_id")
        .contains("appareil", [appareilId])
        .is("restitution_effective", null)
        .limit(1);
      if (engages && engages.length > 0) {
        return {
          ok: false,
          error: "Unité engagée : un prêt ou une réservation est en cours. Clôturez-le ou déplacez-le d'abord.",
        };
      }
    }

    await notionUpdate(appareilId, { "État": P.select(etat) });
    await supabaseAdmin().from("appareils").update({ etat }).eq("notion_id", appareilId);
    await logAudit(session, { action: "status", area: "examens", targetId: appareilId, detail: { etat } });
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

// ============================================================
// Horaires secrétariat (module « planning »)
// Modèle A+B : Supabase = source de vérité (écriture immédiate) ; Notion est
// mis à jour en arrière-plan par le drainer throttlé. Chaque changement marque
// la (secrétaire, semaine) concernée « dirty » pour ce drainer.
// ============================================================

function refreshHoraires() {
  revalidatePath("/horaires", "layout");
  revalidatePath("/agenda", "layout");
}

/** Valeur d'un réglage (table parametres), chaîne vide si absent. */
async function settingValue(admin: ReturnType<typeof supabaseAdmin>, name: string): Promise<string> {
  const { data } = await admin.from("parametres").select("valeur").eq("parametre", name).maybeSingle();
  return (data?.valeur ?? "").trim();
}

/**
 * Droit d'écriture sur les horaires d'une secrétaire :
 * - owner/admin (la médecin) : toujours.
 * - secrétaire : ses propres blocs uniquement, si l'auto-édition est activée
 *   (réglage secretary_self_edit ≠ "off").
 */
async function assertCanWriteHoraire(
  session: Awaited<ReturnType<typeof getSession>>,
  secretaireId: string,
  admin: ReturnType<typeof supabaseAdmin>
): Promise<string | null> {
  if (session.member.is_owner || session.member.role === "admin") return null;
  if (!can(session, "planning")) return "Accès refusé";
  const selfEdit = (await settingValue(admin, "secretary_self_edit")) !== "off";
  if (!selfEdit) return "Modification réservée au médecin";
  if (session.member.personnel_notion_id && session.member.personnel_notion_id === secretaireId) return null;
  return "Vous ne pouvez modifier que vos propres horaires";
}

/** Marque chaque (secrétaire, semaine) des dates données à repousser vers Notion. */
async function markWeeksDirty(admin: ReturnType<typeof supabaseAdmin>, secretaireId: string, dates: string[]) {
  const semaines = Array.from(new Set(dates.map((d) => isoWeek(d))));
  const now = new Date().toISOString();
  for (const semaine of semaines) {
    await admin
      .from("horaires_notion_semaines")
      .upsert(
        { secretaire_notion_id: secretaireId, semaine, dirty: true, updated_at: now },
        { onConflict: "secretaire_notion_id,semaine" }
      );
  }
}

/**
 * Créer un ou plusieurs blocs d'horaire. `repeatWeeks` > 1 génère le même bloc
 * sur le même jour de semaine pour N semaines (blocs individuels, éditables),
 * reliés par un recurring_group_id.
 */
export async function creerHoraire(input: {
  secretaireId: string;
  date: string;
  debut: string;
  fin: string;
  note?: string | null;
  repeatWeeks?: number | null;
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    const admin = supabaseAdmin();
    const guard = await assertCanWriteHoraire(session, input.secretaireId, admin);
    if (guard) return { ok: false, error: guard };
    if (!input.secretaireId) return { ok: false, error: "Secrétaire requise" };
    if (!input.date) return { ok: false, error: "Date requise" };
    if (!isValidRange(input.debut, input.fin)) return { ok: false, error: "L'heure de fin doit être après le début" };

    const weeks = Math.max(1, Math.min(52, Math.floor(input.repeatWeeks ?? 1)));
    const groupId = weeks > 1 ? randomUUID() : null;
    const note = input.note?.trim() || null;
    const dates = Array.from({ length: weeks }, (_, i) => addDays(input.date, i * 7));
    const rows = dates.map((date) => ({
      secretaire_notion_id: input.secretaireId,
      date,
      debut: input.debut,
      fin: input.fin,
      note,
      recurring_group_id: groupId,
      cree_par: session.member.personnel_notion_id ?? null,
      sync_state: "pending",
    }));

    const { error } = await admin.from("horaires_secretariat").insert(rows);
    if (error) return { ok: false, error: error.message };
    await markWeeksDirty(admin, input.secretaireId, dates);
    await logAudit(session, {
      action: "create",
      area: "planning",
      targetId: input.secretaireId,
      detail: { date: input.date, debut: input.debut, fin: input.fin, weeks },
    });
    refreshHoraires();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Modifier un bloc. Les heures/la note changent toujours ; la secrétaire et la
 * date peuvent aussi changer (déplacer le créneau) — réservé à qui a le droit
 * d'écrire à la fois sur l'ancienne ET la nouvelle secrétaire. Les deux semaines
 * concernées sont marquées à repousser vers Notion.
 */
export async function majHoraire(
  id: string,
  input: { secretaireId?: string; date?: string; debut: string; fin: string; note?: string | null }
): Promise<ActionResult> {
  try {
    const session = await getSession();
    const admin = supabaseAdmin();
    const { data: row } = await admin
      .from("horaires_secretariat")
      .select("secretaire_notion_id, date")
      .eq("id", id)
      .maybeSingle();
    if (!row) return { ok: false, error: "Bloc introuvable" };
    // Droit sur le bloc actuel.
    const guard = await assertCanWriteHoraire(session, row.secretaire_notion_id, admin);
    if (guard) return { ok: false, error: guard };
    if (!isValidRange(input.debut, input.fin)) return { ok: false, error: "L'heure de fin doit être après le début" };

    const newSec = input.secretaireId || row.secretaire_notion_id;
    const newDate = input.date || row.date;
    // Réattribution : il faut aussi le droit d'écrire sur la nouvelle secrétaire.
    if (newSec !== row.secretaire_notion_id) {
      const guard2 = await assertCanWriteHoraire(session, newSec, admin);
      if (guard2) return { ok: false, error: guard2 };
    }

    const { error } = await admin
      .from("horaires_secretariat")
      .update({
        secretaire_notion_id: newSec,
        date: newDate,
        debut: input.debut,
        fin: input.fin,
        note: input.note?.trim() || null,
        sync_state: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    // Ancienne position + nouvelle position (peuvent différer de secrétaire/semaine).
    await markWeeksDirty(admin, row.secretaire_notion_id, [row.date]);
    await markWeeksDirty(admin, newSec, [newDate]);
    await logAudit(session, {
      action: "update",
      area: "planning",
      targetId: id,
      detail: { debut: input.debut, fin: input.fin, moved: newSec !== row.secretaire_notion_id || newDate !== row.date },
    });
    refreshHoraires();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Supprimer un bloc (ou toute sa série récurrente si `wholeGroup`). */
export async function supprimerHoraire(id: string, wholeGroup = false): Promise<ActionResult> {
  try {
    const session = await getSession();
    const admin = supabaseAdmin();
    const { data: row } = await admin
      .from("horaires_secretariat")
      .select("secretaire_notion_id, date, recurring_group_id")
      .eq("id", id)
      .maybeSingle();
    if (!row) return { ok: false, error: "Bloc introuvable" };
    const guard = await assertCanWriteHoraire(session, row.secretaire_notion_id, admin);
    if (guard) return { ok: false, error: guard };

    let dates = [row.date];
    if (wholeGroup && row.recurring_group_id) {
      const { data: siblings } = await admin
        .from("horaires_secretariat")
        .select("date")
        .eq("recurring_group_id", row.recurring_group_id);
      dates = (siblings ?? []).map((s) => s.date as string);
      await admin.from("horaires_secretariat").delete().eq("recurring_group_id", row.recurring_group_id);
    } else {
      await admin.from("horaires_secretariat").delete().eq("id", id);
    }
    await markWeeksDirty(admin, row.secretaire_notion_id, dates);
    await logAudit(session, { action: "delete", area: "planning", targetId: id, detail: { wholeGroup } });
    refreshHoraires();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ============================================================
// Messagerie équipe ↔ admin (module « messages »)
//
// Demandé en réunion : un canal pour les remarques et les choses à savoir —
// PAS des tâches. Une conversation par membre, avec l'admin uniquement.
//
// Supabase = source de vérité (écriture immédiate), Notion = miroir rempli par le
// drainer (cf. messages-sync.ts). Chaque écriture laisse le message « pending » et
// marque la page Notion « dirty ».
// ============================================================

function refreshMessages() {
  revalidatePath("/messages", "layout");
  revalidatePath("/", "layout"); // pastille du menu
}

/**
 * Envoie un message. Le membre écrit dans SA conversation ; l'admin répond dans
 * celle d'un membre (`destinataire`).
 *
 * Volontairement une seule action : Next 16 sérialise les server actions d'un même
 * client, donc « envoyer » puis « marquer lu » en parallèle ne se recouvriraient pas.
 * On fait donc tout ici.
 */
export async function envoyerMessage(input: {
  corps: string;
  /** personnel.notion_id du membre dont c'est la conversation. Admin uniquement. */
  destinataire?: string | null;
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "messages")) return { ok: false, error: "Accès refusé" };
    const corps = input.corps.trim();
    if (!corps) return { ok: false, error: "Message vide" };

    const estAdmin = session.member.is_owner || session.member.role === "admin";
    // Un membre écrit toujours dans SA conversation : le destinataire fourni par le
    // client est ignoré pour lui — sinon n'importe qui pourrait poster chez un autre
    // en appelant l'action directement.
    const personnelId = estAdmin ? input.destinataire ?? null : session.member.personnel_notion_id;
    if (!personnelId) {
      return {
        ok: false,
        error: estAdmin
          ? "Destinataire requis"
          : "Votre compte n'est relié à aucune fiche Personnel : impossible d'ouvrir une conversation.",
      };
    }

    const admin = supabaseAdmin();
    const now = new Date().toISOString();

    // Conversation créée à la première prise de parole (unique sur personnel_notion_id).
    const { data: conv, error: convErr } = await admin
      .from("conversations")
      .upsert(
        {
          personnel_notion_id: personnelId,
          dernier_message_at: now,
          // L'auteur a forcément lu ce qu'il vient d'écrire.
          ...(estAdmin ? { lu_admin_at: now } : { lu_membre_at: now }),
        },
        { onConflict: "personnel_notion_id" }
      )
      .select("id")
      .single();
    if (convErr || !conv) return { ok: false, error: convErr?.message ?? "Conversation introuvable" };

    const { error: msgErr } = await admin.from("messages").insert({
      conversation_id: conv.id,
      auteur_member_id: session.member.id,
      auteur_personnel_id: session.member.personnel_notion_id,
      est_admin: estAdmin,
      corps,
      sync_state: "pending",
    });
    if (msgErr) return { ok: false, error: msgErr.message };

    await admin
      .from("messages_notion_pages")
      .upsert({ personnel_notion_id: personnelId, dirty: true, updated_at: now }, { onConflict: "personnel_notion_id" });

    await logAudit(session, { action: "send", area: "messages", targetId: conv.id });
    refreshMessages();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Pose le filigrane de lecture du lecteur courant (fait disparaître la pastille). */
export async function marquerConversationLue(conversationId: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "messages")) return { ok: false, error: "Accès refusé" };
    const admin = supabaseAdmin();

    const { data: conv } = await admin
      .from("conversations")
      .select("id, personnel_notion_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv) return { ok: false, error: "Conversation introuvable" };

    const estAdmin = session.member.is_owner || session.member.role === "admin";
    // Un membre ne peut marquer lue QUE la sienne (l'action est joignable en direct).
    if (!estAdmin && conv.personnel_notion_id !== session.member.personnel_notion_id) {
      return { ok: false, error: "Accès refusé" };
    }

    const now = new Date().toISOString();
    await admin
      .from("conversations")
      .update(estAdmin ? { lu_admin_at: now } : { lu_membre_at: now })
      .eq("id", conversationId);

    refreshMessages();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ============================================================
// Checklist de passation (matin / soir)
// ============================================================

function refreshChecklist() {
  revalidatePath("/secretariat", "layout");
}

/**
 * Coche ou décoche un item POUR AUJOURD'HUI.
 *
 * La coche est datée (clé primaire (item, jour)) : c'est ce qui fait la « remise à zéro
 * quotidienne » du PRD, sans tâche planifiée à minuit ni purge — demain, la requête du jour
 * ne voit simplement plus les coches d'hier, et l'historique reste consultable.
 *
 * `fait_par` retient qui a coché : le PRD veut que l'administration voie l'avancement.
 */
export async function cocherChecklist(itemId: string, coche: boolean): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!can(session, "checklist")) return { ok: false, error: "Accès refusé" };

    const admin = supabaseAdmin();
    const jour = new Date().toISOString().slice(0, 10);

    if (coche) {
      // Idempotent : re-cocher le même jour ne crée pas de doublon (PK (item_id, jour)).
      const { error } = await admin
        .from("checklist_ticks")
        .upsert(
          { item_id: itemId, jour, fait_par: session.member.personnel_notion_id, at: new Date().toISOString() },
          { onConflict: "item_id,jour" }
        );
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await admin.from("checklist_ticks").delete().eq("item_id", itemId).eq("jour", jour);
      if (error) return { ok: false, error: error.message };
    }

    refreshChecklist();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Ajoute un item (administration). */
export async function creerChecklistItem(input: { libelle: string; moment: "Matin" | "Soir" }): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session.member.is_owner && session.member.role !== "admin") return { ok: false, error: "Accès refusé" };
    const libelle = input.libelle.trim();
    if (!libelle) return { ok: false, error: "Libellé requis" };
    if (input.moment !== "Matin" && input.moment !== "Soir") return { ok: false, error: "Moment invalide" };

    const admin = supabaseAdmin();
    // Ajouté en fin de liste de son moment.
    const { data: dernier } = await admin
      .from("checklist_items")
      .select("ordre")
      .eq("moment", input.moment)
      .order("ordre", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: cree, error } = await admin
      .from("checklist_items")
      .insert({ libelle, moment: input.moment, ordre: (dernier?.ordre ?? 0) + 1 })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };

    await logAudit(session, { action: "create", area: "checklist", targetId: cree.id, targetLabel: libelle });
    refreshChecklist();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Renomme / déplace un item (administration). */
export async function majChecklistItem(
  itemId: string,
  input: { libelle?: string; moment?: "Matin" | "Soir" }
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session.member.is_owner && session.member.role !== "admin") return { ok: false, error: "Accès refusé" };

    const patch: Record<string, unknown> = {};
    if (input.libelle !== undefined) {
      const libelle = input.libelle.trim();
      if (!libelle) return { ok: false, error: "Libellé requis" };
      patch.libelle = libelle;
    }
    if (input.moment !== undefined) {
      if (input.moment !== "Matin" && input.moment !== "Soir") return { ok: false, error: "Moment invalide" };
      patch.moment = input.moment;
    }
    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await supabaseAdmin().from("checklist_items").update(patch).eq("id", itemId);
    if (error) return { ok: false, error: error.message };

    await logAudit(session, { action: "update", area: "checklist", targetId: itemId, detail: patch });
    refreshChecklist();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Retire un item de la liste (administration).
 *
 * `actif = false` plutôt qu'un DELETE : les coches sont liées en cascade, les supprimer
 * effacerait l'historique de passation des jours passés. L'item disparaît de la carte,
 * le passé reste intact.
 */
export async function retirerChecklistItem(itemId: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session.member.is_owner && session.member.role !== "admin") return { ok: false, error: "Accès refusé" };

    const { error } = await supabaseAdmin().from("checklist_items").update({ actif: false }).eq("id", itemId);
    if (error) return { ok: false, error: error.message };

    await logAudit(session, { action: "delete", area: "checklist", targetId: itemId });
    refreshChecklist();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
