/**
 * Génération des instances de tâches récurrentes.
 *
 * Décision réunion (juil. 2026) : clôturer une instance ferme **celle-ci seulement** ;
 * la suivante apparaît aussitôt, et la série continue jusqu'à ce qu'on arrête
 * explicitement la récurrence sur la tâche.
 *
 * Deux déclencheurs, une seule fonction :
 *  1. `setStatutTache(... "Terminé")` — le chemin normal, immédiat.
 *  2. `/api/sync` (cron 2 h) — le filet : si (1) a échoué côté Notion, la série
 *     serait rompue en silence. Le filet la répare au prochain passage.
 *
 * D'où l'idempotence : les deux chemins peuvent se croiser, donc on ne crée jamais
 * une instance si le groupe en a déjà une ouverte.
 *
 * Hors « use server » à dessein : dans un fichier server-action, chaque export
 * devient une action appelable en POST direct depuis le navigateur.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { P, notionCreate, notionUpdate } from "@/lib/notion/write";
import { estRecurrente, prochaineEcheance } from "@/lib/recurrence";
import { randomUUID } from "node:crypto";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CHAMPS =
  "notion_id, titre, calendrier, recurrence, recurring_group_id, echeance, priorite, domaine, categorie, note, responsable, cree_par, patient_lie, dossier_lie";

export type InstanceGeneree = { pageId: string; echeance: string; groupId: string } | null;

/**
 * Crée l'instance suivante d'une tâche récurrente clôturée. Ne fait rien si la tâche
 * n'est pas récurrente, n'a pas d'échéance, ou si sa série a déjà une instance ouverte.
 *
 * @returns l'instance créée, ou null si rien n'était à faire.
 */
export async function genererInstanceSuivante(tacheId: string): Promise<InstanceGeneree> {
  const admin = supabaseAdmin();
  const { data: t } = await admin.from("taches").select(CHAMPS).eq("notion_id", tacheId).maybeSingle();
  if (!t) return null;
  return creerSuivante(t as any);
}

/**
 * Filet du cron : répare les séries dont la dernière instance est « Terminé » sans
 * successeur (échec Notion lors de la clôture, p. ex.).
 *
 * Ne regarde que les tâches récurrentes portant un groupe — donc un scan borné.
 */
export async function rattraperRecurrences(): Promise<{ crees: number }> {
  const admin = supabaseAdmin();

  const { data: terminees } = await admin
    .from("taches")
    .select(CHAMPS)
    .eq("calendrier", "Récurrente")
    .eq("statut", "Terminé")
    .not("recurring_group_id", "is", null)
    .order("echeance", { ascending: false })
    .limit(200);

  if (!terminees?.length) return { crees: 0 };

  // Une seule instance (la plus récente) par groupe : creerSuivante revérifie de toute
  // façon qu'aucune n'est ouverte, mais autant ne pas la solliciter N fois par série.
  const parGroupe = new Map<string, any>();
  for (const t of terminees as any[]) {
    if (!parGroupe.has(t.recurring_group_id)) parGroupe.set(t.recurring_group_id, t);
  }

  let crees = 0;
  for (const t of parGroupe.values()) {
    try {
      if (await creerSuivante(t)) crees++;
    } catch {
      // best-effort : une série cassée ne doit pas faire échouer la sync ni les autres
    }
  }
  return { crees };
}

async function creerSuivante(t: any): Promise<InstanceGeneree> {
  if (!estRecurrente(t.calendrier, t.recurrence) || !t.echeance) return null;

  const admin = supabaseAdmin();
  const groupId: string = t.recurring_group_id ?? randomUUID();

  // Garde-fou d'idempotence : une instance ouverte existe déjà → ne rien créer.
  const { data: ouverte } = await admin
    .from("taches")
    .select("notion_id")
    .eq("recurring_group_id", groupId)
    .neq("statut", "Terminé")
    .limit(1)
    .maybeSingle();
  if (ouverte) return null;

  // Le quantième de la série vient de la PREMIÈRE instance : sinon une série « le 31 »
  // passée par février resterait bloquée au 28 (cf. recurrence.test.ts).
  const { data: premiere } = await admin
    .from("taches")
    .select("echeance")
    .eq("recurring_group_id", groupId)
    .not("echeance", "is", null)
    .order("echeance", { ascending: true })
    .limit(1)
    .maybeSingle();
  const ancre = (premiere?.echeance ?? t.echeance).slice(0, 10);
  const anchorDay = new Date(ancre + "T00:00:00").getDate();

  const echeance = prochaineEcheance(t.recurrence, t.echeance, anchorDay);
  if (!echeance) return null;

  const props: Record<string, any> = {
    Titre: P.title(t.titre ?? "Tâche récurrente"),
    Statut: P.select("À faire"),
    Calendrier: P.select("Récurrente"),
    "Récurrence": P.select(t.recurrence),
    Domaine: P.select(t.domaine ?? "Clinique"),
    "Priorité": P.select(t.priorite ?? "Normale"),
    "Échéance": P.date(echeance),
    "Groupe récurrence": P.text(groupId),
  };
  if (t.categorie) props["Catégorie"] = P.select(t.categorie);
  if (t.note) props["Note"] = P.text(t.note);
  if (t.responsable?.length) props["Responsable"] = P.relation(t.responsable);
  if (t.cree_par?.length) props["Créé par"] = P.relation(t.cree_par);
  if (t.patient_lie?.length) props["Patient lié"] = P.relation(t.patient_lie);
  if (t.dossier_lie?.length) props["Dossier lié"] = P.relation(t.dossier_lie);

  const pageId = await notionCreate("taches", props);

  await admin.from("taches").insert({
    notion_id: pageId,
    titre: t.titre,
    statut: "À faire",
    calendrier: "Récurrente",
    recurrence: t.recurrence,
    recurring_group_id: groupId,
    echeance,
    priorite: t.priorite ?? "Normale",
    domaine: t.domaine ?? "Clinique",
    categorie: t.categorie ?? null,
    note: t.note ?? null,
    notifier: false,
    responsable: t.responsable ?? [],
    cree_par: t.cree_par ?? [],
    patient_lie: t.patient_lie ?? [],
    dossier_lie: t.dossier_lie ?? [],
    created_time: new Date().toISOString(),
  });

  // Rattrape les séries antérieures à l'ajout de « Groupe récurrence ».
  if (!t.recurring_group_id) {
    await notionUpdate(t.notion_id, { "Groupe récurrence": P.text(groupId) });
    await admin.from("taches").update({ recurring_group_id: groupId }).eq("notion_id", t.notion_id);
  }

  return { pageId, echeance, groupId };
}
