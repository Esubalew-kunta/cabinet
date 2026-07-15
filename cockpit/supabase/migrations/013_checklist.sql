-- ============================================================
-- Cockpit Dr Amraoui — migration 013 (Checklist de passation, juil. 2026)
--
-- Demandé dans le PRD (Part B.5.4) : une liste matin et une liste soir, des cases
-- à cocher que l'administration définit une fois, que les secrétaires cochent, et
-- qui « repartent à zéro chaque jour ».
--
-- LA REMISE À ZÉRO N'EST PAS UNE TÂCHE PLANIFIÉE. Une coche est datée : la clé
-- primaire (item, jour) fait que « aujourd'hui » ne voit jamais les coches d'hier.
-- Rien à purger, rien à réinitialiser à minuit, et l'historique reste lisible
-- (« l'administration voit l'avancement par jour », même PRD).
--
-- Supabase seul, comme le journal d'audit : ce sont des données d'exploitation de
-- l'app, pas du dossier patient. Pas de miroir Notion (à ajouter si elle le demande,
-- le modèle serait celui des Horaires : drainer write-behind).
-- Additif uniquement.
-- ============================================================

-- ---------- 1. Les items (définis par l'administration) ----------

create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  libelle text not null,
  moment text not null check (moment in ('Matin', 'Soir')),
  ordre int not null default 0,
  actif boolean not null default true,       -- retiré de la liste sans perdre l'historique
  created_at timestamptz default now()
);

create index if not exists checklist_items_moment_idx on checklist_items (moment, ordre) where actif;

-- ---------- 2. Les coches (une par item ET par jour) ----------

create table if not exists checklist_ticks (
  item_id uuid not null references checklist_items(id) on delete cascade,
  jour date not null,
  fait_par uuid,                             -- personnel.notion_id : « qui a fait quoi »
  at timestamptz not null default now(),
  primary key (item_id, jour)                -- une seule coche par jour, et pas de doublon
);

create index if not exists checklist_ticks_jour_idx on checklist_ticks (jour desc);

-- ---------- 3. Zone de permission "checklist" ----------
-- Routine du secrétariat : secrétaires + administration. Modifiable dans la matrice.

insert into app_permissions (role, area, level) values
  ('medecin','checklist','none'),
  ('secretaire','checklist','full'),
  ('ipa','checklist','none'),
  ('externe','checklist','none'),
  ('admin','checklist','full')
on conflict (role, area) do nothing;

-- ---------- 4. RLS ----------
-- Lecture : la zone. Écritures : service role uniquement (server actions), comme partout.

alter table checklist_items enable row level security;
drop policy if exists checklist_items_read on checklist_items;
create policy checklist_items_read on checklist_items for select to authenticated using (
  app_perm('checklist') <> 'none'
);

alter table checklist_ticks enable row level security;
drop policy if exists checklist_ticks_read on checklist_ticks;
create policy checklist_ticks_read on checklist_ticks for select to authenticated using (
  app_perm('checklist') <> 'none'
);

-- ---------- 5. Amorce ----------
-- Les trois exemples qu'elle a donnés (PRD B.5.4), pour que la carte ne soit pas vide
-- le premier jour. Modifiables et supprimables depuis l'app.
-- Garde d'idempotence : on n'amorce que si la table est vide.

insert into checklist_items (libelle, moment, ordre)
select * from (values
  ('Ouvrir et préparer les salles', 'Matin', 1),
  ('Vérifier les appareils à rendre aujourd''hui', 'Matin', 2),
  ('Fermer la caisse', 'Soir', 1)
) as v(libelle, moment, ordre)
where not exists (select 1 from checklist_items);
