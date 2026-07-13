-- ============================================================
-- Cockpit Dr Amraoui — migration 010 (Horaires secrétariat, juil. 2026)
-- Calendrier des heures de travail des secrétaires.
--
-- Modèle A+B : Supabase = source de vérité temps réel (écriture instantanée),
-- Notion = miroir « grossier » (une page par secrétaire · semaine) rempli en
-- arrière-plan par un drainer throttlé → jamais de 429 Notion.
--   1) horaires_secretariat      : un bloc = une ligne (granulaire)
--   2) horaires_notion_semaines  : mapping (secrétaire, semaine ISO) → page Notion
--   3) zone de permission "planning" (matrice)
--   4) RLS lecture = app_perm('planning') ; écritures = service role
-- Additif uniquement — aucune table/colonne existante modifiée.
-- ============================================================

-- ---------- 1. Blocs d'horaires (granulaire, source de vérité) ----------

create table if not exists horaires_secretariat (
  id uuid primary key default gen_random_uuid(),
  secretaire_notion_id uuid not null,          -- personnel.notion_id de la secrétaire
  date date not null,
  debut text not null,                         -- 'HH:mm'
  fin text not null,                           -- 'HH:mm'  (validé fin > début côté action)
  note text,
  recurring_group_id uuid,                      -- lie les blocs générés par « appliquer aux jours »
  cree_par uuid,                                -- personnel.notion_id de l'auteur
  sync_state text not null default 'pending',   -- pending | synced  (drainer Notion)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists horaires_date_idx on horaires_secretariat (date);
create index if not exists horaires_secretaire_date_idx on horaires_secretariat (secretaire_notion_id, date);
create index if not exists horaires_pending_idx on horaires_secretariat (sync_state) where sync_state = 'pending';
create index if not exists horaires_group_idx on horaires_secretariat (recurring_group_id);

-- ---------- 2. Mapping semaine → page Notion (miroir grossier B) ----------
-- Le drainer regroupe les blocs pending par (secrétaire, semaine ISO) et
-- upsert UNE seule page Notion par groupe : ~10× moins d'appels API.

create table if not exists horaires_notion_semaines (
  secretaire_notion_id uuid not null,
  semaine text not null,                        -- 'YYYY-Www' (ex. 2026-W29)
  notion_page_id text,
  dirty boolean not null default true,          -- à repousser vers Notion (create/edit/delete d'un bloc)
  updated_at timestamptz default now(),
  primary key (secretaire_notion_id, semaine)
);
-- garde-fou si la table existait déjà sans la colonne
alter table horaires_notion_semaines add column if not exists dirty boolean not null default true;
create index if not exists horaires_semaines_dirty_idx on horaires_notion_semaines (dirty) where dirty;

-- ---------- 3. Zone de permission "planning" ----------
-- Médecin (Dr Amraoui = owner/admin → full auto) définit tout ; secrétaires
-- lisent tout + écrivent leurs propres blocs (garde-fou dans l'action +
-- réglage secretary_self_edit). Modifiable dans la matrice comme les autres.

insert into app_permissions (role, area, level) values
  ('medecin','planning','none'),
  ('secretaire','planning','full'),
  ('ipa','planning','none'),
  ('externe','planning','none'),
  ('admin','planning','full')
on conflict (role, area) do nothing;

-- ---------- 4. RLS ----------

alter table horaires_secretariat enable row level security;

drop policy if exists horaires_read on horaires_secretariat;
create policy horaires_read on horaires_secretariat for select to authenticated using (
  app_perm('planning') <> 'none'
);

-- Écritures : service role uniquement (comme partout ailleurs).

-- Table de mapping : réservée au serveur (service role). RLS activée sans
-- policy select → invisible aux clients authentifiés, accessible au service role.
alter table horaires_notion_semaines enable row level security;
