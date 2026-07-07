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

// Récurrences : libellés FR/EN dans src/lib/i18n/dict.ts (RECURRENCE)

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
  "examens", "perfusions", "paiements_own", "paiements_all", "finances", "admin_stats",
  "gestion_comptes", "sync",
] as const;
