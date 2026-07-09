/**
 * Configuration du sync : pour chaque base Notion, l'id du data source,
 * la table Supabase cible et le mapping propriété Notion → colonne.
 * Ids vérifiés en lecture directe du cockpit Notion (juil. 2026).
 */

export type PropKind =
  | "title"
  | "rich_text"
  | "number"
  | "select"
  | "multi_select"
  | "date"
  | "checkbox"
  | "email"
  | "phone"
  | "url"
  | "relation"
  | "unique_id";

export type PropSpec = { prop: string; column: string; kind: PropKind };

export type SourceSpec = {
  table: string;
  dataSourceId: string;
  props: PropSpec[];
};

export const SOURCES: SourceSpec[] = [
  {
    table: "patients",
    dataSourceId: "7c2756ad-9127-4eff-8d19-f2420664e2aa",
    props: [
      { prop: "Nom", column: "nom", kind: "title" },
      { prop: "Prénom", column: "prenom", kind: "rich_text" },
      { prop: "Nom de famille", column: "nom_famille", kind: "rich_text" },
      { prop: "Nom complet", column: "nom_complet", kind: "rich_text" },
      { prop: "PSID", column: "psid", kind: "unique_id" },
      { prop: "Statut", column: "statut", kind: "select" },
      { prop: "Type patient", column: "type_patient", kind: "select" },
      { prop: "Problème principal", column: "probleme_principal", kind: "select" },
      { prop: "Niveau de vigilance", column: "niveau_vigilance", kind: "select" },
      { prop: "Téléphone", column: "telephone", kind: "phone" },
      { prop: "Phone", column: "phone", kind: "phone" },
      { prop: "Phone 1", column: "phone_1", kind: "phone" },
      { prop: "Email", column: "email", kind: "email" },
      { prop: "Email 1", column: "email_1", kind: "email" },
      { prop: "Lien Doctolib", column: "lien_doctolib", kind: "url" },
      { prop: "Lien dossier sécurisé", column: "lien_dossier_securise", kind: "url" },
      { prop: "Dernier RDV", column: "dernier_rdv", kind: "date" },
      { prop: "Prochain RDV", column: "prochain_rdv", kind: "date" },
      { prop: "Rappel RDV envoyé le", column: "rappel_rdv_envoye_le", kind: "date" },
      { prop: "Médecin assigné", column: "medecin_assigne", kind: "relation" },
      { prop: "Date de naissance", column: "date_naissance", kind: "date" },
      { prop: "Adresse", column: "adresse", kind: "rich_text" },
      { prop: "Notes secrétariat", column: "notes_secretariat", kind: "rich_text" },
    ],
  },
  {
    table: "dossiers",
    dataSourceId: "b37a9ab8-b638-4648-b5f4-b30a86e0e32f",
    props: [
      { prop: "ID Dossier", column: "id_dossier", kind: "title" },
      { prop: "Patient", column: "patient", kind: "relation" },
      { prop: "Motif", column: "motif", kind: "select" },
      { prop: "Résumé motif", column: "resume_motif", kind: "rich_text" },
      { prop: "Priorité", column: "priorite", kind: "select" },
      { prop: "Site", column: "site", kind: "select" },
      { prop: "Source", column: "source", kind: "select" },
      { prop: "Lien Doctolib", column: "lien_doctolib", kind: "url" },
      { prop: "Infos manquantes", column: "infos_manquantes", kind: "multi_select" },
      { prop: "Statut intake", column: "statut_intake", kind: "select" },
      { prop: "Revue secrétaire", column: "revue_secretaire", kind: "multi_select" },
      { prop: "Statut médecin", column: "statut_medecin", kind: "select" },
      { prop: "Visible médecin", column: "visible_medecin", kind: "checkbox" },
      { prop: "Médecin assigné", column: "medecin_assigne", kind: "relation" },
      { prop: "Rendez-vous", column: "rendez_vous", kind: "date" },
      { prop: "Dossier parent", column: "dossier_parent", kind: "relation" },
      { prop: "Statut CR", column: "statut_cr", kind: "select" },
      { prop: "CR envoyé le", column: "cr_envoye_le", kind: "date" },
      { prop: "Lien CR", column: "lien_cr", kind: "url" },
      { prop: "Ordonnance remise", column: "ordonnance_remise", kind: "checkbox" },
    ],
  },
  {
    table: "taches",
    dataSourceId: "66303da0-61e8-40a5-adfc-0b63ab7c2c14",
    props: [
      { prop: "Titre", column: "titre", kind: "title" },
      { prop: "Statut", column: "statut", kind: "select" },
      { prop: "Calendrier", column: "calendrier", kind: "select" },
      { prop: "Récurrence", column: "recurrence", kind: "select" },
      { prop: "Échéance", column: "echeance", kind: "date" },
      { prop: "Priorité", column: "priorite", kind: "select" },
      { prop: "Domaine", column: "domaine", kind: "select" },
      { prop: "Note de clôture", column: "note_cloture", kind: "rich_text" },
      { prop: "Note", column: "note", kind: "rich_text" },
      { prop: "Événement agenda", column: "evenement_agenda", kind: "rich_text" },
      { prop: "Notifier", column: "notifier", kind: "checkbox" },
      { prop: "Notifié le", column: "notifie_le", kind: "date" },
      { prop: "Responsable", column: "responsable", kind: "relation" },
      { prop: "Créé par", column: "cree_par", kind: "relation" },
      { prop: "Patient lié", column: "patient_lie", kind: "relation" },
      { prop: "Dossier lié", column: "dossier_lie", kind: "relation" },
    ],
  },
  {
    table: "examens",
    dataSourceId: "bb4c7b0c-2af6-457a-b513-eee6304c9a36",
    props: [
      { prop: "Réf examen", column: "ref_examen", kind: "title" },
      { prop: "Type", column: "type", kind: "select" },
      { prop: "Indication", column: "indication", kind: "select" },
      { prop: "Site", column: "site", kind: "select" },
      { prop: "Statut appareil", column: "statut_appareil", kind: "select" },
      { prop: "Appareillage", column: "appareillage", kind: "select" },
      { prop: "Numéro appareil", column: "numero_appareil", kind: "rich_text" },
      { prop: "Date de pose", column: "date_pose", kind: "date" },
      { prop: "Restitution prévue", column: "restitution_prevue", kind: "date" },
      { prop: "Restitution effective", column: "restitution_effective", kind: "date" },
      { prop: "Date interprétation", column: "date_interpretation", kind: "date" },
      { prop: "Conclusion", column: "conclusion", kind: "select" },
      { prop: "Date envoi", column: "date_envoi", kind: "date" },
      { prop: "Rappel retour envoyé le", column: "rappel_retour_envoye_le", kind: "date" },
      { prop: "Alerte retard envoyée le", column: "alerte_retard_envoyee_le", kind: "date" },
      { prop: "Confirmation envoyée le", column: "confirmation_envoyee_le", kind: "date" },
      { prop: "Remerciement envoyé le", column: "remerciement_envoye_le", kind: "date" },
      { prop: "Notes", column: "notes", kind: "rich_text" },
      { prop: "Résultats", column: "resultats", kind: "rich_text" },
      { prop: "Patient", column: "patient", kind: "relation" },
      { prop: "Interprète", column: "interprete", kind: "relation" },
      { prop: "Responsable", column: "responsable", kind: "relation" },
      { prop: "Paiement", column: "paiement", kind: "relation" },
      { prop: "Appareil", column: "appareil", kind: "relation" },
      { prop: "CAT", column: "cat", kind: "select" },
      { prop: "Contacté pour appareillage", column: "contacte_appareillage", kind: "checkbox" },
      { prop: "Société d'appareillage", column: "societe_appareillage", kind: "select" },
      { prop: "Appareillage posé le", column: "appareillage_pose_le", kind: "date" },
      { prop: "RDV suivi PGV", column: "rdv_suivi_pgv", kind: "date" },
      { prop: "RDV pneumologue", column: "rdv_pneumologue", kind: "date" },
    ],
  },
  {
    table: "appareils",
    dataSourceId: "b1163fb7-59b9-48d1-af6c-f6616cb06d90",
    props: [
      { prop: "Réf", column: "ref_appareil", kind: "title" },
      { prop: "Type", column: "type", kind: "select" },
      { prop: "Numéro", column: "numero", kind: "rich_text" },
      { prop: "État", column: "etat", kind: "select" },
      { prop: "Examen en cours", column: "examen_en_cours", kind: "relation" },
      { prop: "Notes", column: "notes", kind: "rich_text" },
      { prop: "Date d'achat", column: "date_achat", kind: "date" },
    ],
  },
  {
    table: "paiements",
    dataSourceId: "857deea7-c38e-40b0-8926-904197a9bdff",
    props: [
      { prop: "Réf paiement", column: "ref_paiement", kind: "title" },
      { prop: "Type de prestation", column: "type_prestation", kind: "select" },
      { prop: "Mode de paiement", column: "mode_paiement", kind: "select" }, // nouveau champ
      { prop: "Statut paiement", column: "statut_paiement", kind: "select" },
      { prop: "Suivi", column: "suivi", kind: "select" },
      { prop: "Montant dû", column: "montant_du", kind: "number" },
      { prop: "Montant payé", column: "montant_paye", kind: "number" },
      { prop: "Échéance", column: "echeance", kind: "date" },
      { prop: "Rappel envoyé le", column: "rappel_envoye_le", kind: "date" },
      { prop: "Notes", column: "notes", kind: "rich_text" },
      { prop: "Patient", column: "patient", kind: "relation" },
      { prop: "Examen", column: "examen", kind: "relation" },
      { prop: "Perfusion", column: "perfusion", kind: "relation" },
      { prop: "Responsable", column: "responsable", kind: "relation" },
    ],
  },
  {
    table: "perfusions",
    dataSourceId: "9e3904e4-c6c4-4f42-aff5-ff5269c8cc41",
    props: [
      { prop: "Réf perfusion", column: "ref_perfusion", kind: "title" },
      { prop: "Date de perfusion", column: "date_perfusion", kind: "date" },
      { prop: "Composants", column: "composants", kind: "rich_text" },
      { prop: "Durée", column: "duree", kind: "rich_text" },
      { prop: "Honoraire IPA", column: "honoraire_ipa", kind: "number" },
      { prop: "Bilan bio", column: "bilan_bio", kind: "select" },
      { prop: "Notes", column: "notes", kind: "rich_text" },
      { prop: "Patient", column: "patient", kind: "relation" },
      { prop: "Paiement", column: "paiement", kind: "relation" },
    ],
  },
  {
    table: "stock",
    dataSourceId: "345f2d30-2b7a-483d-8d29-b79e4cc024d6",
    props: [
      { prop: "Article", column: "article", kind: "title" },
      { prop: "Catégorie", column: "categorie", kind: "select" },
      { prop: "Quantité", column: "quantite", kind: "number" },
      { prop: "Unité", column: "unite", kind: "select" },
      { prop: "Seuil minimum", column: "seuil_minimum", kind: "number" },
      { prop: "Fournisseur", column: "fournisseur", kind: "rich_text" },
      { prop: "Dernier réappro", column: "dernier_reappro", kind: "date" },
      { prop: "Notes", column: "notes", kind: "rich_text" },
    ],
  },
  {
    table: "stock_mouvements",
    dataSourceId: "27e87acf-ce88-4d9c-bc67-42d6cf4ffb96",
    props: [
      { prop: "Réf", column: "ref_mouvement", kind: "title" },
      { prop: "Article", column: "article", kind: "relation" },
      { prop: "Sens", column: "sens", kind: "select" },
      { prop: "Quantité", column: "quantite", kind: "number" },
      { prop: "Motif", column: "motif", kind: "rich_text" },
      { prop: "Par", column: "par", kind: "relation" },
      { prop: "Date", column: "date_mouvement", kind: "date" },
    ],
  },
  {
    table: "personnel",
    dataSourceId: "2895672b-5349-4ac6-a505-a6aad98c3495",
    props: [
      { prop: "Nom", column: "nom", kind: "title" },
      { prop: "Prénom", column: "prenom", kind: "rich_text" },
      { prop: "Nom de famille", column: "nom_famille", kind: "rich_text" },
      { prop: "Rôle", column: "role", kind: "select" },
      { prop: "Spécialité", column: "specialite", kind: "select" },
      { prop: "Email", column: "email", kind: "email" },
      { prop: "Actif", column: "actif", kind: "checkbox" },
    ],
  },
  {
    table: "parametres",
    dataSourceId: "3fc46cf9-571e-4482-b2e7-d25a087d707c",
    props: [
      { prop: "Paramètre", column: "parametre", kind: "title" },
      { prop: "Valeur", column: "valeur", kind: "rich_text" },
      { prop: "Description", column: "description", kind: "rich_text" },
    ],
  },
  {
    table: "rapports",
    dataSourceId: "f8a138c4-b695-443f-aefc-8cd94c54eb28",
    props: [
      { prop: "Titre", column: "titre", kind: "title" },
      { prop: "Type", column: "type", kind: "select" },
      { prop: "Date", column: "date_rapport", kind: "date" },
      { prop: "À lire", column: "a_lire", kind: "number" },
      { prop: "À envoyer", column: "a_envoyer", kind: "number" },
      { prop: "Appareils en retard", column: "appareils_en_retard", kind: "number" },
      { prop: "Paiements à relancer", column: "paiements_a_relancer", kind: "number" },
      { prop: "Dossiers à valider", column: "dossiers_a_valider", kind: "number" },
    ],
  },
  {
    table: "taches_perso",
    dataSourceId: "840fa987-9a85-4bc8-b17c-5f9cf39f06f5",
    props: [
      // Base privée de la Dre : mapping best-effort, tout est gardé dans `raw`.
      { prop: "Titre", column: "titre", kind: "title" },
      { prop: "Statut", column: "statut", kind: "select" },
      { prop: "Échéance", column: "echeance", kind: "date" },
      { prop: "Priorité", column: "priorite", kind: "select" },
    ],
  },
  {
    table: "abonnes",
    dataSourceId: "b10ac025-1beb-4878-8166-3f0ae4176292",
    props: [
      { prop: "Nom", column: "nom", kind: "title" },
      { prop: "Prénom", column: "prenom", kind: "rich_text" },
      { prop: "Email", column: "email", kind: "email" },
      { prop: "Statut", column: "statut", kind: "select" },
      { prop: "Source", column: "source", kind: "select" },
      { prop: "Date d'inscription", column: "date_inscription", kind: "date" },
    ],
  },
];
