/**
 * French vocabulary — copied verbatim from the Notion cockpit so the team
 * never has to relearn a word. Also maps every status to a badge tone.
 */

export type Tone =
  | "gray" | "blue" | "green" | "yellow" | "orange" | "red" | "violet";

const tone = (t: Tone) => t;

/** Dossiers — Statut intake */
export const STATUT_INTAKE: Record<string, Tone> = {
  "Nouveau": tone("gray"),
  "Rapprochement": tone("blue"),
  "Rédaction": tone("violet"),
  "Revue": tone("yellow"),
  "Info manquante": tone("orange"),
  "Prêt": tone("green"),
  "En attente": tone("blue"),
  "En cours": tone("orange"),
  "Terminé": tone("green"),
};

/** Dossiers — Statut médecin */
export const STATUT_MEDECIN: Record<string, Tone> = {
  "À valider": tone("violet"),
  "En rédaction": tone("red"),
  "À lire": tone("blue"),
  "Non visible": tone("gray"),
  "En attente": tone("yellow"),
  "En cours": tone("orange"),
  "Terminé": tone("green"),
};

/** Dossiers — Revue secrétaire (multi-select) */
export const REVUE_SECRETAIRE: Record<string, Tone> = {
  "À faire": tone("gray"),
  "À vérifier": tone("yellow"),
  "Info demandée": tone("orange"),
  "Brouillon validé": tone("blue"),
  "Vérifié": tone("green"),
};

/** Tâches — Statut */
export const STATUT_TACHE: Record<string, Tone> = {
  "À faire": tone("gray"),
  "En cours": tone("blue"),
  "En attente": tone("yellow"),
  "Bloqué": tone("red"),
  "Terminé": tone("green"),
};

export const PRIORITE: Record<string, Tone> = {
  "Normale": tone("gray"),
  "À revoir": tone("yellow"),
  "Urgent": tone("red"),
};

export const DOMAINE_TACHE: Record<string, Tone> = {
  "Clinique": tone("blue"),
  "Professionnel": tone("violet"),
  "Personnel": tone("green"),
  "Projets": tone("orange"),
};

/**
 * Tâches — Catégorie (réunion juil. 2026).
 * Axe distinct de Domaine : Domaine porte la confidentialité (RLS « Personnel »),
 * Catégorie sert au tri quotidien du cabinet.
 */
export const CATEGORIE_TACHE: Record<string, Tone> = {
  "Administration": tone("blue"),
  "Patient": tone("violet"),
  "Mobilier": tone("orange"),
  "Paiement": tone("green"),
};

export const CATEGORIES_TACHE = ["Administration", "Patient", "Mobilier", "Paiement"] as const;

/** Options Notion de « Récurrence » (valeurs stockées telles quelles ; libellés : dict RECURRENCE). */
export const RECURRENCES = ["daily", "weekdays", "weekly", "monthly", "yearly"] as const;
export type RecurrenceKey = (typeof RECURRENCES)[number];

/** Examens / appareils */
export const STATUT_APPAREIL: Record<string, Tone> = {
  "Disponible": tone("gray"),
  "Remis": tone("blue"),
  "Bientôt dû": tone("yellow"),
  "En retard": tone("red"),
  "Rendu": tone("green"),
  "Perdu": tone("orange"),
  "Endommagé": tone("orange"),
};

/** Paiements */
export const STATUT_PAIEMENT: Record<string, Tone> = {
  "Payé": tone("green"),
  "Impayé": tone("red"),
  "Partiel": tone("yellow"),
  "Inconnu": tone("gray"),
};

export const SUIVI_PAIEMENT: Record<string, Tone> = {
  "Non contacté": tone("gray"),
  "Email envoyé": tone("blue"),
  "Appelé": tone("yellow"),
  "Résolu": tone("green"),
};

export const MODES_PAIEMENT = ["Carte", "Espèces", "Chèque", "Virement"] as const;

/** Appareils — inventaire physique (État d'une unité) */
export const ETAT_APPAREIL_UNITE: Record<string, Tone> = {
  "Au cabinet": tone("green"),
  "Dehors": tone("blue"),
  "Maintenance": tone("yellow"),
  "Perdu": tone("orange"),
  "Réformé": tone("gray"),
};

// « Moniteur ECG » retiré en juil. 2026 (réunion) : unité archivée dans Notion et
// option supprimée des deux selects « Type » (Appareils et Examens).
export const TYPES_APPAREIL = ["Holter rythmique", "Holter tensionnel", "Polygraphie"] as const;

/** Dossiers — cycle de vie du compte rendu */
export const STATUT_CR: Record<string, Tone> = {
  "À rédiger": tone("orange"),
  "À valider": tone("violet"),
  "Envoyé": tone("green"),
};

/** Examens — conduite à tenir (polygraphie) */
export const CONCLUSION_EXAMEN: Record<string, Tone> = {
  "Normal": tone("green"),
  "Anormal": tone("red"),
  "À revoir": tone("orange"),
  "Incomplet": tone("yellow"),
};

export const CAT_EXAMEN: Record<string, Tone> = {
  "RAS": tone("green"),
  "Polysomnographie": tone("violet"),
  "Mettre une PPC": tone("orange"),
  "Refaire l'examen": tone("yellow"),
  "Autre": tone("gray"),
};

export const SOCIETES_APPAREILLAGE = ["Air+", "Autre"] as const;

/** Vocabulaire des formulaires Dossier (copié des options Notion) */
export const SOURCES_DOSSIER = ["Téléphone", "WhatsApp", "Doctolib", "Sur place", "Email", "Site web"] as const;
export const SITES = ["Cardio Check-Up", "Hôpital Américain de Paris"] as const;
export const MOTIFS_DOSSIER = [
  "Rythmologie", "Holter", "Hypertension", "Cardiologie préventive", "PGV", "Suivi",
  "Suivi appareil", "Suivi post-ablation", "Syncope ou vertige", "Gêne thoracique", "Dépistage",
  "Nutrition/surpoids", "Prévention", "Doppler vasculaire", "Avis chirurgical", "Perfusion", "Post-op", "Autre",
] as const;
export const INDICATIONS_EXAMEN = ["FA", "HTA", "ESV", "Palpitations", "SAS", "Syncope", "Autre"] as const;

/** Inventaire (consommables) */
export const CATEGORIES_STOCK = ["Consommable", "Fourniture", "Pièce appareil", "Autre"] as const;
export const UNITES_STOCK = ["pièces", "boîtes", "ml", "paires"] as const;

export const STATUT_STOCK: Record<string, Tone> = {
  "OK": tone("green"),
  "Bas": tone("orange"),
  "Rupture": tone("red"),
};

/** Abonnés — Statut liste de diffusion */
export const STATUT_ABONNE: Record<string, Tone> = {
  "Actif": tone("green"),
  "Désabonné": tone("gray"),
};

/** Patients */
export const STATUT_PATIENT: Record<string, Tone> = {
  "Actif": tone("green"),
  "Inactif": tone("gray"),
};

export const NIVEAU_VIGILANCE: Record<string, Tone> = {
  "Routine": tone("gray"),
  "À revoir": tone("yellow"),
  "Haute attention": tone("orange"),
  "Vérif secrétaire": tone("red"),
};

// Rôles et zones : libellés FR/EN dans src/lib/i18n/dict.ts (ROLE_LABELS, AREA_LABELS)
export const ROLE_TONES: Record<string, Tone> = {
  admin: "violet",
  medecin: "blue",
  secretaire: "green",
  ipa: "orange",
  externe: "gray",
};

/** Ordre d'affichage des zones de la matrice de permissions */
export const AREA_KEYS = [
  "patients_all", "patients_own", "dossiers_all", "dossiers_own", "taches", "taches_perso_dr",
  "messages", "checklist",
  "examens", "stock", "planning", "perfusions", "paiements_own", "paiements_all", "finances", "admin_stats",
  "gestion_comptes", "sync",
] as const;
