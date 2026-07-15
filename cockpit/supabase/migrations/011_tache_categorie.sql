-- Cockpit Dr Amraoui — migration 011 : catégorie + chaînage des tâches récurrentes.
--
-- Catégorie (réunion juil. 2026) : Administration / Patient / Mobilier / Paiement.
-- Axe NOUVEAU et distinct de `domaine` (Clinique/Professionnel/Personnel/Projets), qui
-- reste inchangé : c'est lui qui porte la règle RLS des tâches « Personnel » de la Dre
-- (cf. 001_init.sql, policy taches_read).
--
-- recurring_group_id : relie les instances successives d'une tâche récurrente.
-- Indispensable à l'idempotence de la génération (cron /api/sync toutes les 2 h) :
-- sans lui, impossible de savoir si l'instance suivante existe déjà → doublons.

alter table taches add column if not exists categorie text;
alter table taches add column if not exists recurring_group_id uuid;

-- Filtrage par catégorie sur la page Tâches.
create index if not exists taches_categorie_idx on taches (categorie);

-- Recherche « une instance ouverte de ce groupe existe-t-elle ? » (générateur récurrent).
-- Partiel : seules les tâches récurrentes portent un groupe.
create index if not exists taches_recurring_group_idx
  on taches (recurring_group_id)
  where recurring_group_id is not null;
