-- ============================================================
-- Cockpit Dr Amraoui — migration 003 (tâches & inventaire, juil. 2026)
-- 1) Tables miroir du module Inventaire : stock + stock_mouvements
-- 2) Nouvelle zone de permission "stock" (matrice)
-- 3) IPA traitée comme un médecin : matrice par défaut alignée
-- Additif uniquement — aucune colonne existante modifiée.
-- ============================================================

-- ---------- 1. Inventaire (une ligne = un article consommable) ----------

create table if not exists stock (
  notion_id uuid primary key,
  created_time timestamptz,
  last_edited_time timestamptz,
  article text,
  categorie text,                -- Consommable / Fourniture / Pièce appareil / Autre
  quantite numeric,
  unite text,
  seuil_minimum numeric,
  fournisseur text,
  dernier_reappro date,
  notes text,
  raw jsonb,
  synced_at timestamptz default now()
);

create index if not exists stock_categorie_idx on stock (categorie);

-- Journal des mouvements : chaque entrée/sortie est une ligne (auditable).
create table if not exists stock_mouvements (
  notion_id uuid primary key,
  created_time timestamptz,
  last_edited_time timestamptz,
  ref_mouvement text,
  article uuid[] default '{}',
  sens text,                     -- Entrée / Sortie
  quantite numeric,
  motif text,
  par uuid[] default '{}',
  date_mouvement timestamptz,
  raw jsonb,
  synced_at timestamptz default now()
);

create index if not exists stock_mouvements_article_idx on stock_mouvements using gin (article);

-- ---------- 2. Zone de permission "stock" ----------
-- Ajout d'article = admin (contrôlé dans l'action) ; réappro / sortie =
-- secrétariat + admin. Modifiable dans la matrice comme les autres zones.

insert into app_permissions (role, area, level) values
  ('medecin','stock','none'),
  ('secretaire','stock','full'),
  ('ipa','stock','none'),
  ('externe','stock','none'),
  ('admin','stock','full')
on conflict (role, area) do nothing;

-- ---------- 3. RLS ----------

alter table stock enable row level security;
alter table stock_mouvements enable row level security;

drop policy if exists stock_read on stock;
create policy stock_read on stock for select to authenticated using (
  app_perm('stock') <> 'none'
);

drop policy if exists stock_mouvements_read on stock_mouvements;
create policy stock_mouvements_read on stock_mouvements for select to authenticated using (
  app_perm('stock') <> 'none'
);

-- Écritures : service role uniquement (comme partout ailleurs).

-- ---------- 4. IPA = médecin (décision 8 juil.) ----------
-- Rita voit ses dossiers vérifiés et les examens comme un médecin.

update app_permissions set level = 'full'
where role = 'ipa' and area in ('dossiers_own', 'examens', 'paiements_own');
