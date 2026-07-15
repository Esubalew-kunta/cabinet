-- ============================================================
-- Cockpit Dr Amraoui — migration 014 (Nutrition : la part du médecin, juil. 2026)
--
-- Demande : « pour la section nutrition, combien reverser au médecin qui a traité le
-- patient, sur ce que le patient a payé ».
--
-- Il manquait le principal : une perfusion n'enregistrait PAS son praticien (ni la
-- séance, ni le paiement lié). Sans lui, il n'y a personne à qui reverser.
--
-- Le taux vit dans Paramètres (`nutrition_part_medecin_pct`, Notion = source de vérité,
-- mirroité ici par la sync) — pas de colonne dédiée : l'éditeur de réglages typé le rend
-- déjà en compteur −/+.
-- Additif uniquement.
-- ============================================================

alter table perfusions add column if not exists praticien uuid[];

create index if not exists perfusions_praticien_idx on perfusions using gin (praticien);
