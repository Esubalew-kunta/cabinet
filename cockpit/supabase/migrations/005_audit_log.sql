-- ============================================================
-- Cockpit Dr Amraoui — migration 005 (journal d'audit, juil. 2026)
-- Traçabilité : qui a fait quoi, quand, sur quel enregistrement.
-- App-only (télémétrie d'exploitation) — pas de miroir Notion : ce n'est pas
-- une donnée clinique, elle ne vit que dans l'app. Lecture réservée admin/owner.
-- Additif uniquement.
-- ============================================================

create table if not exists audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  member_id    uuid,           -- app_members.id de l'auteur (si connu)
  actor_email  text,           -- dénormalisé pour l'affichage / le filtre
  actor_nom    text,
  action       text not null,  -- create | update | delete | verify | assign | return | collect | penalty | stock_move | interpret | send | setting …
  area         text,           -- patients | dossiers | taches | examens | appareils | paiements | perfusions | stock | abonnes | parametres | comptes …
  target_id    text,           -- notion_id / id de l'enregistrement touché
  target_label text,           -- libellé lisible (nom patient, réf, titre)
  detail       jsonb,          -- contexte / avant→après
  synced_at    timestamptz default now()
);

create index if not exists audit_log_at_idx on audit_log (at desc);
create index if not exists audit_log_member_idx on audit_log (member_id);
create index if not exists audit_log_area_idx on audit_log (area);
create index if not exists audit_log_action_idx on audit_log (action);

alter table audit_log enable row level security;

-- Lecture : admin / owner uniquement.
drop policy if exists audit_log_read on audit_log;
create policy audit_log_read on audit_log for select to authenticated using (
  app_is_owner() or app_role() = 'admin'
);

-- Écriture : service role uniquement (les server actions écrivent via supabaseAdmin,
-- qui contourne la RLS) — aucune policy d'insert pour 'authenticated'.
