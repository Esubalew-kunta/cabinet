-- ============================================================
-- Cockpit Dr Amraoui — migration 004 (liste de diffusion, juil. 2026)
-- Table miroir des abonnés à la liste de conseils santé (opt-in email).
-- Source de vérité = Notion « Abonnés » ; ici on ne fait que lire le miroir.
-- Nouvelle zone de permission "abonnes" (secrétariat + admin).
-- Additif uniquement — aucune colonne existante modifiée.
-- ============================================================

-- ---------- 1. Table miroir des abonnés ----------
create table if not exists abonnes (
  notion_id uuid primary key,
  created_time timestamptz,
  last_edited_time timestamptz,
  nom text,
  prenom text,
  email text,
  statut text,                   -- Actif / Désabonné
  source text,                   -- Email remerciement / Site web / Sur place / Autre
  date_inscription date,
  raw jsonb,
  synced_at timestamptz default now()
);

create index if not exists abonnes_statut_idx on abonnes (statut);
create index if not exists abonnes_email_idx on abonnes (email);

-- ---------- 2. Zone de permission "abonnes" ----------
-- Gestion de la liste = secrétariat + admin. Médecins / externes : aucun accès.
insert into app_permissions (role, area, level) values
  ('medecin','abonnes','none'),
  ('secretaire','abonnes','full'),
  ('ipa','abonnes','none'),
  ('externe','abonnes','none'),
  ('admin','abonnes','full')
on conflict (role, area) do nothing;

-- ---------- 3. RLS ----------
alter table abonnes enable row level security;

drop policy if exists abonnes_read on abonnes;
create policy abonnes_read on abonnes for select to authenticated using (
  app_perm('abonnes') <> 'none'
);

-- Écritures : service role uniquement (comme partout ailleurs).
