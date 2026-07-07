-- ============================================================
-- Cockpit Dr Amraoui — schéma initial
-- Tables miroir de Notion (source: sync) + tables applicatives.
-- Toutes les tables miroir sont clé = notion_id (uuid de la page Notion).
-- Les relations Notion sont stockées en text[] d'ids de pages Notion.
-- Chaque ligne garde aussi `raw` (jsonb) = toutes les propriétés Notion,
-- pour ne jamais perdre une donnée présente dans Notion.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Tables miroir ----------

create table patients (
  notion_id uuid primary key,
  created_time timestamptz,
  last_edited_time timestamptz,
  nom text,
  nom_complet text,
  psid integer,
  statut text,
  type_patient text,
  probleme_principal text,
  niveau_vigilance text,
  telephone text,
  phone text,
  phone_1 text,
  email text,
  email_1 text,
  lien_doctolib text,
  lien_dossier_securise text,
  dernier_rdv timestamptz,
  prochain_rdv timestamptz,
  rappel_rdv_envoye_le timestamptz,
  medecin_assigne uuid[] default '{}',
  raw jsonb,
  synced_at timestamptz default now()
);

create table dossiers (
  notion_id uuid primary key,
  created_time timestamptz,
  last_edited_time timestamptz,
  id_dossier text,
  patient uuid[] default '{}',
  motif text,
  resume_motif text,
  priorite text,
  site text,
  source text,
  lien_doctolib text,
  infos_manquantes text[] default '{}',
  statut_intake text,
  revue_secretaire text[] default '{}',
  statut_medecin text,
  visible_medecin boolean default false,
  medecin_assigne uuid[] default '{}',
  rendez_vous timestamptz,
  raw jsonb,
  synced_at timestamptz default now()
);

create table taches (
  notion_id uuid primary key,
  created_time timestamptz,
  last_edited_time timestamptz,
  titre text,
  statut text,
  calendrier text,
  recurrence text,
  echeance timestamptz,
  priorite text,
  domaine text,
  note_cloture text,
  evenement_agenda text,
  notifier boolean default false,
  notifie_le timestamptz,
  responsable uuid[] default '{}',
  cree_par uuid[] default '{}',
  patient_lie uuid[] default '{}',
  dossier_lie uuid[] default '{}',
  raw jsonb,
  synced_at timestamptz default now()
);

create table examens (
  notion_id uuid primary key,
  created_time timestamptz,
  last_edited_time timestamptz,
  ref_examen text,
  type text,
  indication text,
  site text,
  statut_appareil text,
  appareillage text,
  numero_appareil text,
  date_pose timestamptz,
  restitution_prevue timestamptz,
  restitution_effective timestamptz,
  date_interpretation timestamptz,
  date_envoi timestamptz,
  rappel_retour_envoye_le timestamptz,
  alerte_retard_envoyee_le timestamptz,
  confirmation_envoyee_le timestamptz,
  remerciement_envoye_le timestamptz,
  notes text,
  resultats text,
  patient uuid[] default '{}',
  interprete uuid[] default '{}',
  responsable uuid[] default '{}',
  paiement uuid[] default '{}',
  raw jsonb,
  synced_at timestamptz default now()
);

create table paiements (
  notion_id uuid primary key,
  created_time timestamptz,
  last_edited_time timestamptz,
  ref_paiement text,
  type_prestation text,
  mode_paiement text,          -- nouveau champ (Carte / Espèces / Chèque / Virement)
  statut_paiement text,
  suivi text,
  montant_du numeric,
  montant_paye numeric,
  solde numeric generated always as (coalesce(montant_du,0) - coalesce(montant_paye,0)) stored,
  echeance timestamptz,
  rappel_envoye_le timestamptz,
  notes text,
  patient uuid[] default '{}',
  examen uuid[] default '{}',
  perfusion uuid[] default '{}',
  responsable uuid[] default '{}',
  raw jsonb,
  synced_at timestamptz default now()
);

create table perfusions (
  notion_id uuid primary key,
  created_time timestamptz,
  last_edited_time timestamptz,
  ref_perfusion text,
  date_perfusion timestamptz,
  composants text,
  duree text,
  honoraire_ipa numeric,
  bilan_bio text,
  notes text,
  patient uuid[] default '{}',
  paiement uuid[] default '{}',
  raw jsonb,
  synced_at timestamptz default now()
);

create table personnel (
  notion_id uuid primary key,
  created_time timestamptz,
  last_edited_time timestamptz,
  nom text,
  role text,
  email text,
  actif boolean default true,
  raw jsonb,
  synced_at timestamptz default now()
);

create table parametres (
  notion_id uuid primary key,
  created_time timestamptz,
  last_edited_time timestamptz,
  parametre text,
  valeur text,
  description text,
  raw jsonb,
  synced_at timestamptz default now()
);

create table rapports (
  notion_id uuid primary key,
  created_time timestamptz,
  last_edited_time timestamptz,
  titre text,
  type text,
  date_rapport timestamptz,
  a_lire numeric,
  a_envoyer numeric,
  appareils_en_retard numeric,
  paiements_a_relancer numeric,
  dossiers_a_valider numeric,
  raw jsonb,
  synced_at timestamptz default now()
);

-- Tâches personnelles de la Dre (base Notion séparée, privée)
create table taches_perso (
  notion_id uuid primary key,
  created_time timestamptz,
  last_edited_time timestamptz,
  titre text,
  statut text,
  echeance timestamptz,
  priorite text,
  raw jsonb,
  synced_at timestamptz default now()
);

-- ---------- Tables applicatives ----------

create table app_members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text unique not null,
  nom text,
  personnel_notion_id uuid,
  role text not null check (role in ('admin','medecin','secretaire','ipa','externe')),
  is_owner boolean not null default false,   -- Dr Amraoui : voit tout + tâches perso
  active boolean not null default true,
  created_at timestamptz default now()
);

create table app_permissions (
  role text not null check (role in ('admin','medecin','secretaire','ipa','externe')),
  area text not null,
  level text not null default 'none' check (level in ('none','status','full')),
  primary key (role, area)
);

create table sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','error')),
  trigger_source text not null default 'cron',
  detail jsonb,
  error text
);

-- ---------- Index ----------

create index on patients using gin (medecin_assigne);
create index on patients (statut);
create index on patients (psid);
create index on dossiers using gin (medecin_assigne);
create index on dossiers using gin (patient);
create index on dossiers (statut_intake);
create index on dossiers (visible_medecin);
create index on taches using gin (responsable);
create index on taches (statut);
create index on taches (domaine);
create index on examens using gin (patient);
create index on examens (statut_appareil);
create index on paiements using gin (patient);
create index on paiements (statut_paiement);
create index on perfusions using gin (patient);

-- ---------- Fonctions d'aide (contexte du membre connecté) ----------

create or replace function app_member()
returns app_members
language sql stable security definer set search_path = public as $$
  select m from app_members m where m.auth_user_id = auth.uid() and m.active;
$$;

create or replace function app_role() returns text
language sql stable security definer set search_path = public as $$
  select (app_member()).role;
$$;

create or replace function app_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((app_member()).is_owner, false);
$$;

create or replace function app_personnel_id() returns uuid
language sql stable security definer set search_path = public as $$
  select (app_member()).personnel_notion_id;
$$;

-- Niveau d'accès pour une zone. Owner et admin = full partout.
create or replace function app_perm(p_area text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when app_is_owner() or app_role() = 'admin' then 'full'
    else coalesce(
      (select level from app_permissions where role = app_role() and area = p_area),
      'none')
  end;
$$;

-- Les patients assignés au membre connecté (pour les médecins)
create or replace function app_my_patient_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.notion_id from patients p
  where p.medecin_assigne @> array[app_personnel_id()];
$$;

-- ---------- RLS ----------

alter table patients enable row level security;
alter table dossiers enable row level security;
alter table taches enable row level security;
alter table examens enable row level security;
alter table paiements enable row level security;
alter table perfusions enable row level security;
alter table personnel enable row level security;
alter table parametres enable row level security;
alter table rapports enable row level security;
alter table taches_perso enable row level security;
alter table app_members enable row level security;
alter table app_permissions enable row level security;
alter table sync_runs enable row level security;

-- Lecture patients : tous, ou les miens
create policy patients_read on patients for select to authenticated using (
  app_perm('patients_all') <> 'none'
  or (app_perm('patients_own') <> 'none' and medecin_assigne @> array[app_personnel_id()])
);

-- Lecture dossiers : portail médecin respecté au niveau base
create policy dossiers_read on dossiers for select to authenticated using (
  case
    when app_perm('dossiers_all') <> 'none' then true
    when app_perm('dossiers_own') <> 'none' then
      medecin_assigne @> array[app_personnel_id()] and visible_medecin
    else false
  end
);

-- Lecture tâches : partagées ; domaine "Personnel" réservé owner/admin
create policy taches_read on taches for select to authenticated using (
  app_perm('taches') <> 'none'
  and (coalesce(domaine,'') <> 'Personnel' or app_perm('taches_perso_dr') = 'full')
);

-- Examens : tout voir si full ; médecins → leurs examens ou leurs patients
create policy examens_read on examens for select to authenticated using (
  case
    when app_perm('examens') = 'full' and app_perm('patients_all') <> 'none' then true
    when app_perm('examens') <> 'none' then
      interprete @> array[app_personnel_id()]
      or responsable @> array[app_personnel_id()]
      or patient && array(select app_my_patient_ids())
    else false
  end
);

-- Paiements (table de base) : montants complets uniquement
create policy paiements_read on paiements for select to authenticated using (
  app_perm('paiements_all') = 'full'
);

-- Perfusions
create policy perfusions_read on perfusions for select to authenticated using (
  app_perm('perfusions') <> 'none'
);

-- Personnel : lisible par tous les membres actifs (noms nécessaires partout)
create policy personnel_read on personnel for select to authenticated using (
  app_role() is not null
);

-- Paramètres / rapports / sync : zone admin
create policy parametres_read on parametres for select to authenticated using (
  app_perm('admin_stats') = 'full'
);
create policy rapports_read on rapports for select to authenticated using (
  app_perm('admin_stats') = 'full'
);
create policy sync_runs_read on sync_runs for select to authenticated using (
  app_perm('sync') = 'full'
);

-- Tâches perso Dre : owner/admin uniquement
create policy taches_perso_read on taches_perso for select to authenticated using (
  app_perm('taches_perso_dr') = 'full'
);

-- app_members : sa propre ligne ; owner/admin voient tout
create policy members_read on app_members for select to authenticated using (
  auth_user_id = auth.uid() or app_perm('gestion_comptes') = 'full'
);

-- app_permissions : lisible par tous (le client en a besoin pour l'UI)
create policy permissions_read on app_permissions for select to authenticated using (true);

-- Aucune policy INSERT/UPDATE/DELETE : toutes les écritures passent par le
-- service role (routes serveur), qui contourne la RLS.

-- ---------- Vue paiements pour les médecins (statut de leurs patients) ----------
-- Vue "security definer" (propriétaire) : filtre par patients du médecin,
-- masque les montants si le niveau est 'status'.

create or replace view v_paiements_mes_patients as
select
  p.notion_id,
  p.ref_paiement,
  p.type_prestation,
  p.statut_paiement,
  p.suivi,
  p.echeance,
  p.patient,
  case when app_perm('paiements_own') = 'full' then p.montant_du  end as montant_du,
  case when app_perm('paiements_own') = 'full' then p.montant_paye end as montant_paye,
  case when app_perm('paiements_own') = 'full' then p.solde end as solde,
  p.mode_paiement
from paiements p
where app_perm('paiements_own') <> 'none'
  and p.patient && array(select app_my_patient_ids());

grant select on v_paiements_mes_patients to authenticated;

-- ---------- Matrice par défaut ----------

insert into app_permissions (role, area, level) values
  -- médecin (associé)
  ('medecin','patients_all','none'),
  ('medecin','patients_own','full'),
  ('medecin','dossiers_all','none'),
  ('medecin','dossiers_own','full'),
  ('medecin','taches','full'),
  ('medecin','taches_perso_dr','none'),
  ('medecin','examens','full'),
  ('medecin','perfusions','none'),
  ('medecin','paiements_own','full'), -- décision 7 juil. : les médecins voient les montants (modifiable dans la matrice)
  ('medecin','paiements_all','none'),
  ('medecin','finances','none'),
  ('medecin','admin_stats','none'),
  ('medecin','gestion_comptes','none'),
  ('medecin','sync','none'),
  -- secrétaire (compte partagé)
  ('secretaire','patients_all','full'),
  ('secretaire','patients_own','none'),
  ('secretaire','dossiers_all','full'),
  ('secretaire','dossiers_own','none'),
  ('secretaire','taches','full'),
  ('secretaire','taches_perso_dr','none'),
  ('secretaire','examens','full'),
  ('secretaire','perfusions','full'),
  ('secretaire','paiements_own','none'),
  ('secretaire','paiements_all','full'),
  ('secretaire','finances','none'),
  ('secretaire','admin_stats','none'),
  ('secretaire','gestion_comptes','none'),
  ('secretaire','sync','none'),
  -- IPA
  ('ipa','patients_all','none'),
  ('ipa','patients_own','full'),
  ('ipa','dossiers_all','none'),
  ('ipa','dossiers_own','none'),
  ('ipa','taches','full'),
  ('ipa','taches_perso_dr','none'),
  ('ipa','examens','none'),
  ('ipa','perfusions','full'),
  ('ipa','paiements_own','none'),
  ('ipa','paiements_all','none'),
  ('ipa','finances','none'),
  ('ipa','admin_stats','none'),
  ('ipa','gestion_comptes','none'),
  ('ipa','sync','none'),
  -- externe
  ('externe','patients_all','none'),
  ('externe','patients_own','none'),
  ('externe','dossiers_all','none'),
  ('externe','dossiers_own','none'),
  ('externe','taches','none'),
  ('externe','taches_perso_dr','none'),
  ('externe','examens','none'),
  ('externe','perfusions','none'),
  ('externe','paiements_own','none'),
  ('externe','paiements_all','none'),
  ('externe','finances','none'),
  ('externe','admin_stats','none'),
  ('externe','gestion_comptes','none'),
  ('externe','sync','none'),
  -- admin (explicite, même si app_perm force full)
  ('admin','patients_all','full'),
  ('admin','patients_own','full'),
  ('admin','dossiers_all','full'),
  ('admin','dossiers_own','full'),
  ('admin','taches','full'),
  ('admin','taches_perso_dr','full'),
  ('admin','examens','full'),
  ('admin','perfusions','full'),
  ('admin','paiements_own','full'),
  ('admin','paiements_all','full'),
  ('admin','finances','full'),
  ('admin','admin_stats','full'),
  ('admin','gestion_comptes','full'),
  ('admin','sync','full');
