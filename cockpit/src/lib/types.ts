/** Rows mirrored from Notion into Supabase (snake_case = DB columns). */

export type Patient = {
  notion_id: string;
  created_time: string | null;
  nom: string | null;
  prenom: string | null;
  nom_famille: string | null;
  nom_complet: string | null;
  psid: number | null;
  statut: string | null;
  type_patient: string | null;
  probleme_principal: string | null;
  niveau_vigilance: string | null;
  telephone: string | null;
  phone: string | null;
  phone_1: string | null;
  email: string | null;
  email_1: string | null;
  lien_doctolib: string | null;
  lien_dossier_securise: string | null;
  dernier_rdv: string | null;
  prochain_rdv: string | null;
  rappel_rdv_envoye_le: string | null;
  medecin_assigne: string[];
  date_naissance: string | null;
  adresse: string | null;
  notes_secretariat: string | null;
};

export type Dossier = {
  notion_id: string;
  created_time: string | null;
  id_dossier: string | null;
  patient: string[];
  motif: string | null;
  resume_motif: string | null;
  priorite: string | null;
  site: string | null;
  source: string | null;
  lien_doctolib: string | null;
  infos_manquantes: string[];
  statut_intake: string | null;
  revue_secretaire: string[];
  statut_medecin: string | null;
  visible_medecin: boolean;
  medecin_assigne: string[];
  rendez_vous: string | null;
  dossier_parent: string[];
  statut_cr: string | null;
  cr_envoye_le: string | null;
  lien_cr: string | null;
  ordonnance_remise: boolean;
};

export type Tache = {
  notion_id: string;
  created_time: string | null;
  titre: string | null;
  statut: string | null;
  calendrier: string | null;          // Ponctuelle | Récurrente
  recurrence: string | null;          // libellé Notion : Quotidienne | Jours ouvrés | …
  recurring_group_id: string | null;  // relie les instances d'une série récurrente
  echeance: string | null;
  priorite: string | null;
  domaine: string | null;             // Clinique | Professionnel | Personnel | Projets (porte la RLS)
  categorie: string | null;           // Administration | Patient | Mobilier | Paiement
  note_cloture: string | null;
  note: string | null;
  responsable: string[];
  cree_par: string[];
  patient_lie: string[];
  dossier_lie: string[];
};

export type Examen = {
  notion_id: string;
  ref_examen: string | null;
  type: string | null;
  indication: string | null;
  site: string | null;
  statut_appareil: string | null;
  appareillage: string | null;
  numero_appareil: string | null;
  date_pose: string | null;
  restitution_prevue: string | null;
  restitution_effective: string | null;
  date_interpretation: string | null;
  date_envoi: string | null;
  notes: string | null;
  resultats: string | null;
  conclusion: string | null;
  patient: string[];
  interprete: string[];
  responsable: string[];
  appareil: string[];
  cat: string | null;
  contacte_appareillage: boolean;
  societe_appareillage: string | null;
  appareillage_pose_le: string | null;
  rdv_suivi_pgv: string | null;
  rdv_pneumologue: string | null;
};

export type Appareil = {
  notion_id: string;
  ref_appareil: string | null;
  type: string | null;
  numero: string | null;
  etat: string | null;
  examen_en_cours: string[];
  notes: string | null;
  date_achat: string | null;
};

export type Paiement = {
  notion_id: string;
  ref_paiement: string | null;
  type_prestation: string | null;
  mode_paiement: string | null;
  statut_paiement: string | null;
  suivi: string | null;
  montant_du: number | null;
  montant_paye: number | null;
  solde: number | null;
  echeance: string | null;
  notes: string | null;
  patient: string[];
  responsable: string[];
};

export type Perfusion = {
  notion_id: string;
  ref_perfusion: string | null;
  date_perfusion: string | null;
  composants: string | null;
  duree: string | null;
  honoraire_ipa: number | null;
  bilan_bio: string | null;
  notes: string | null;
  patient: string[];
};

export type Article = {
  notion_id: string;
  article: string | null;
  categorie: string | null;
  quantite: number | null;
  unite: string | null;
  seuil_minimum: number | null;
  fournisseur: string | null;
  dernier_reappro: string | null;
  notes: string | null;
};

export type Mouvement = {
  notion_id: string;
  ref_mouvement: string | null;
  article: string[];
  sens: string | null;
  quantite: number | null;
  motif: string | null;
  par: string[];
  date_mouvement: string | null;
};

export type AuditEntry = {
  id: number;
  at: string;
  member_id: string | null;
  actor_email: string | null;
  actor_nom: string | null;
  action: string;
  area: string | null;
  target_id: string | null;
  target_label: string | null;
  detail: Record<string, unknown> | null;
};

export type Abonne = {
  notion_id: string;
  nom: string | null;
  prenom: string | null;
  email: string | null;
  statut: string | null;
  source: string | null;
  date_inscription: string | null;
};

/** Un bloc d'horaire de travail d'une secrétaire (module Horaires). */
export type Horaire = {
  id: string;
  secretaire_notion_id: string;
  date: string;                 // 'YYYY-MM-DD'
  debut: string;                // 'HH:mm'
  fin: string;                  // 'HH:mm'
  note: string | null;
  recurring_group_id: string | null;
  cree_par: string | null;
  sync_state: string;           // pending | synced
  created_at: string | null;
  updated_at: string | null;
};

/**
 * Messagerie équipe ↔ admin (module Messages).
 * Une conversation par membre — « seulement avec l'admin » (réunion juil. 2026).
 */
export type Conversation = {
  id: string;
  personnel_notion_id: string;
  dernier_message_at: string;
  lu_admin_at: string | null;
  lu_membre_at: string | null;
  created_at: string | null;
};

export type Message = {
  id: string;
  conversation_id: string;
  auteur_member_id: string;
  auteur_personnel_id: string | null;
  est_admin: boolean;
  corps: string;
  sync_state: string;
  created_at: string | null;
};

export type PersonnelRow = {
  notion_id: string;
  nom: string | null;
  prenom: string | null;
  nom_famille: string | null;
  role: string | null;
  specialite: string | null;
  email: string | null;
  actif: boolean;
};

export type AppMember = {
  id: string;
  auth_user_id: string | null;
  email: string;
  nom: string | null;
  personnel_notion_id: string | null;
  role: "admin" | "medecin" | "secretaire" | "ipa" | "externe";
  is_owner: boolean;
  active: boolean;
};

export type SyncRun = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "error";
  trigger_source: string;
  detail: Record<string, number> | null;
  error: string | null;
};

export type PermLevel = "none" | "status" | "full";
export type Permissions = Record<string, PermLevel>;
