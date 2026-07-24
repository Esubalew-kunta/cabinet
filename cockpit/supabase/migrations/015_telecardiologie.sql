-- ============================================================
-- Cockpit Dr Amraoui — migration 015 (Télécardiologie, juil. 2026)
--
-- Le suivi de facturation de la télésurveillance des prothèses cardiaques
-- (pacemakers / défibrillateurs). Reprend le tableau Excel « Patients à facturer
-- Dr AMRAOUI » : une ligne par patient porteur, et — chaque mois — la secrétaire
-- coche si l'acte de télésurveillance a été facturé.
--
-- MODÈLE « UNE COLONNE PAR MOIS » SANS MIGRATION MENSUELLE. On ne met pas un mois
-- par colonne SQL (il faudrait migrer chaque mois). À la place : une table de
-- patients, et une table de statuts (patient, mois) — un nouveau mois n'est
-- qu'une nouvelle ligne. La grille de l'app affiche les mois trouvés + le mois
-- courant, donc la colonne du mois en cours existe toujours, même vide.
--
-- Statut tri-état, à dessein : la source distingue « oui » (facturé), « non »
-- (pas facturé) et vide (pas encore applicable — 1ère facturation à venir).
-- facture = true / false / null respectivement.
--
-- Supabase seul, comme la Checklist et l'audit : données d'exploitation de l'app,
-- alimentées une fois depuis l'Excel puis vécues dans l'app. Pas de miroir Notion.
-- Écritures : service role uniquement (server actions), comme partout.
-- Additif uniquement — aucune colonne existante modifiée.
-- ============================================================

-- ---------- 1. Les patients porteurs ----------

create table if not exists telecardio_patients (
  id uuid primary key default gen_random_uuid(),
  nom text,
  prenom text,
  sexe text,                                  -- 'M' / 'F' / null
  date_naissance date,
  date_implantation date,
  date_debut_hm date,                         -- début de la télésurveillance (Home Monitoring)
  num_serie text,                             -- N° série PM/DCI
  num_pid text,                               -- N° PID
  type_appareil text,                         -- ex. « Edora 8 DR-T », « Acticor 7 DR-T »
  categorie text not null default 'prothese'  -- 'prothese' (PM/DAI) | 'holter' (holters implantables)
    check (categorie in ('prothese', 'holter')),
  commentaire text,
  actif boolean not null default true,        -- retiré de la liste sans perdre l'historique
  ordre int not null default 0,               -- conserve l'ordre de l'Excel à l'import
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telecardio_patients_actif_idx on telecardio_patients (actif, ordre);
create index if not exists telecardio_patients_nom_idx on telecardio_patients (nom);

-- ---------- 2. Les statuts mensuels (un par patient ET par mois) ----------

create table if not exists telecardio_statuts (
  patient_id uuid not null references telecardio_patients(id) on delete cascade,
  mois date not null,                         -- toujours le 1er du mois (ex. 2025-09-01)
  facture boolean,                            -- true = Oui, false = Non, null = non renseigné
  updated_by uuid,                            -- personnel.notion_id : « qui a coché »
  updated_at timestamptz not null default now(),
  primary key (patient_id, mois)              -- une seule case par patient et par mois
);

create index if not exists telecardio_statuts_mois_idx on telecardio_statuts (mois desc);

-- ---------- 3. Tenir updated_at à jour (patients) ----------
-- Même convention que 001/010/012 : un trigger touche updated_at à chaque écriture.

create or replace function telecardio_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists telecardio_patients_touch on telecardio_patients;
create trigger telecardio_patients_touch
  before update on telecardio_patients
  for each row execute function telecardio_touch_updated_at();

-- ---------- 4. Zone de permission "telecardiologie" ----------
-- Suivi de facturation du secrétariat : secrétaires + administration.
-- Médecins / IPA / externes : aucun accès. Modifiable dans la matrice des accès.

insert into app_permissions (role, area, level) values
  ('medecin','telecardiologie','none'),
  ('secretaire','telecardiologie','full'),
  ('ipa','telecardiologie','none'),
  ('externe','telecardiologie','none'),
  ('admin','telecardiologie','full')
on conflict (role, area) do nothing;

-- ---------- 5. RLS ----------
-- Lecture : la zone. Écritures : service role uniquement (server actions).

alter table telecardio_patients enable row level security;
drop policy if exists telecardio_patients_read on telecardio_patients;
create policy telecardio_patients_read on telecardio_patients for select to authenticated using (
  app_perm('telecardiologie') <> 'none'
);

alter table telecardio_statuts enable row level security;
drop policy if exists telecardio_statuts_read on telecardio_statuts;
create policy telecardio_statuts_read on telecardio_statuts for select to authenticated using (
  app_perm('telecardiologie') <> 'none'
);
