-- ============================================================
-- Cockpit Dr Amraoui — migration 002 (master plan, juil. 2026)
-- 1) Nouvelle table miroir `appareils` (inventaire physique)
-- 2) Nouveaux champs : patients / dossiers / examens
-- 3) RLS de la nouvelle table
-- Additif uniquement — aucune colonne existante modifiée.
-- ============================================================

-- ---------- 1. Appareils (une ligne = un boîtier physique) ----------

create table if not exists appareils (
  notion_id uuid primary key,
  created_time timestamptz,
  last_edited_time timestamptz,
  ref_appareil text,
  type text,
  numero text,
  etat text,                      -- Au cabinet / Dehors / Maintenance / Perdu / Réformé
  examen_en_cours uuid[] default '{}',
  notes text,
  date_achat date,
  raw jsonb,
  synced_at timestamptz default now()
);

create index if not exists appareils_type_idx on appareils (type);
create index if not exists appareils_etat_idx on appareils (etat);
create index if not exists appareils_examen_idx on appareils using gin (examen_en_cours);

-- ---------- 2. Nouveaux champs ----------

-- Patients : état civil + notes non cliniques du secrétariat
alter table patients add column if not exists date_naissance date;
alter table patients add column if not exists adresse text;               -- SENS
alter table patients add column if not exists notes_secretariat text;

-- Dossiers : chaîne de référence + cycle de vie du compte rendu
alter table dossiers add column if not exists dossier_parent uuid[] default '{}';
alter table dossiers add column if not exists statut_cr text;             -- À rédiger / À valider / Envoyé
alter table dossiers add column if not exists cr_envoye_le timestamptz;
alter table dossiers add column if not exists lien_cr text;               -- SENS
alter table dossiers add column if not exists ordonnance_remise boolean default false;

create index if not exists dossiers_parent_idx on dossiers using gin (dossier_parent);
create index if not exists dossiers_statut_cr_idx on dossiers (statut_cr);

-- Personnel : spécialité (alimente le choix du destinataire d'un dossier de suite)
alter table personnel add column if not exists specialite text;

-- Examens : lien vers l'appareil physique + parcours appareillage (SAS)
alter table examens add column if not exists appareil uuid[] default '{}';
alter table examens add column if not exists cat text;                    -- conduite à tenir
alter table examens add column if not exists contacte_appareillage boolean default false;
alter table examens add column if not exists societe_appareillage text;
alter table examens add column if not exists appareillage_pose_le timestamptz;
alter table examens add column if not exists rdv_suivi_pgv timestamptz;
alter table examens add column if not exists rdv_pneumologue timestamptz;

create index if not exists examens_appareil_idx on examens using gin (appareil);
create index if not exists examens_cat_idx on examens (cat);

-- ---------- 3. RLS ----------

alter table appareils enable row level security;

-- L'inventaire suit la zone "examens" : secrétariat + médecins le voient,
-- owner/admin toujours (app_perm force full).
drop policy if exists appareils_read on appareils;
create policy appareils_read on appareils for select to authenticated using (
  app_perm('examens') <> 'none'
);

-- Écritures : service role uniquement (comme partout ailleurs).
