-- ============================================================
-- Cockpit Dr Amraoui — migration 012 (Messagerie équipe ↔ admin, juil. 2026)
--
-- Demandé en réunion : un endroit où l'équipe écrit à la Dre des remarques et
-- des choses à savoir — PAS des tâches (« il faut acheter X pour le cabinet »).
-- Elle les reçoit dans une boîte de réception et répond. Notification in-app des
-- deux côtés. Ce n'est PAS un chat temps réel.
--
-- Modèle (repris des Horaires) : Supabase = source de vérité, Notion = miroir
-- rempli en arrière-plan par un drainer throttlé.
--
-- UNE conversation par membre (décision : « seulement avec l'admin ») : la
-- contrainte unique en fait une garantie de la base, pas une convention.
-- Additif uniquement.
-- ============================================================

-- ---------- 1. Conversations (une par membre du personnel) ----------

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  personnel_notion_id uuid not null unique,     -- le membre ; UNIQUE = « une seule chacun »
  dernier_message_at timestamptz not null default now(),
  lu_admin_at timestamptz,                      -- filigrane de lecture côté admin
  lu_membre_at timestamptz,                     -- filigrane de lecture côté membre
  created_at timestamptz default now()
);

create index if not exists conversations_dernier_idx on conversations (dernier_message_at desc);

-- ---------- 2. Messages ----------

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  auteur_member_id uuid not null,               -- app_members.id (membre OU admin)
  auteur_personnel_id uuid,                     -- personnel.notion_id de l'auteur (affichage)
  est_admin boolean not null default false,     -- réponse de l'admin ?
  corps text not null,
  sync_state text not null default 'pending',   -- pending | synced (drainer Notion)
  created_at timestamptz default now()
);

create index if not exists messages_conversation_idx on messages (conversation_id, created_at);
create index if not exists messages_pending_idx on messages (sync_state) where sync_state = 'pending';

-- ---------- 3. Mapping conversation → page Notion (miroir) ----------

create table if not exists messages_notion_pages (
  personnel_notion_id uuid primary key,
  notion_page_id text,
  dirty boolean not null default true,
  updated_at timestamptz default now()
);
create index if not exists messages_notion_dirty_idx on messages_notion_pages (dirty) where dirty;

-- ---------- 4. Zone de permission "messages" ----------
-- Tout le monde peut écrire à l'admin : c'est l'intérêt même de la zone.
-- Owner/admin ont 'full' d'office (cf. app_perm).

insert into app_permissions (role, area, level) values
  ('medecin','messages','full'),
  ('secretaire','messages','full'),
  ('ipa','messages','full'),
  ('externe','messages','none'),
  ('admin','messages','full')
on conflict (role, area) do nothing;

-- ---------- 5. RLS ----------
-- La promesse de confidentialité de la fonctionnalité tient ICI, pas dans l'UI :
-- une server action est joignable en POST direct, quel que soit ce que le rendu montre.
-- Un membre ne voit QUE sa conversation ; l'admin/owner voit tout.

alter table conversations enable row level security;

drop policy if exists conversations_read on conversations;
create policy conversations_read on conversations for select to authenticated using (
  app_perm('messages') <> 'none'
  and (
    app_is_owner()
    or app_role() = 'admin'
    or personnel_notion_id = app_personnel_id()
  )
);

alter table messages enable row level security;

drop policy if exists messages_read on messages;
create policy messages_read on messages for select to authenticated using (
  app_perm('messages') <> 'none'
  and (
    app_is_owner()
    or app_role() = 'admin'
    or exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and c.personnel_notion_id = app_personnel_id()
    )
  )
);

-- Écritures : service role uniquement (comme partout ailleurs).

-- Table de mapping : réservée au serveur. RLS activée sans policy select
-- → invisible aux clients authentifiés, accessible au service role.
alter table messages_notion_pages enable row level security;
