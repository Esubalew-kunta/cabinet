-- ============================================================
-- Cockpit Dr Amraoui — migration 006 (noms séparés, juil. 2026)
-- Prénom + Nom de famille sur patients et personnel. Le champ `nom` reste
-- le nom complet (composé) pour l'affichage / les rollups / les emails.
-- Additif — aucune colonne existante modifiée.
-- ============================================================

alter table patients  add column if not exists prenom text;
alter table patients  add column if not exists nom_famille text;

alter table personnel add column if not exists prenom text;
alter table personnel add column if not exists nom_famille text;
