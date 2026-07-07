# Cockpit Dr Amraoui — Web App Implementation Plan

**Goal:** A simple, nice, genuinely usable French-language web app for Dr. Amraoui's cardiology clinic (Cardio Check-Up), sitting on top of the existing Notion cockpit. Notion = back office. Supabase = fast reliable copy the app reads. Staff never open Notion.

---

## 1. Architecture

```
Notion (Cockpit Dr Amraoui — 10 databases)
   │  sync (pull, every 5–10 min + manual "Sync now")
   ▼
Supabase (Postgres + Auth + RLS)  ←— reads ——  Next.js web app (Vercel)
   ▲                                              │
   └───── writes: app → Notion API (1 row) ───────┘
          then mirrored optimistically into Supabase
```

- **Reads:** always from Supabase (fast, no Notion rate limits).
- **Writes** (task status change, verify dossier, record payment, new patient…): the app writes the single row to **Notion API** (Notion stays source of truth), and updates the Supabase row optimistically so the UI is instant. Next sync reconciles.
- **Sync worker:** a Next.js route (`/api/sync`) triggered by Vercel Cron + a manual button in Admin. Full pull per database with `last_edited_time` cursor (incremental after first run).
- **Hosting:** Vercel (frontend + sync route) + Supabase. **No VPS.**

## 2. Notion sources (real IDs, verified by live read)

| Table | Notion data source ID |
|---|---|
| patients | `7c2756ad-9127-4eff-8d19-f2420664e2aa` |
| dossiers | `b37a9ab8-b638-4648-b5f4-b30a86e0e32f` |
| taches | `66303da0-61e8-40a5-adfc-0b63ab7c2c14` |
| examens (devices/exams) | `bb4c7b0c-2af6-457a-b513-eee6304c9a36` |
| paiements | `857deea7-c38e-40b0-8926-904197a9bdff` |
| perfusions | `9e3904e4-c6c4-4f42-aff5-ff5269c8cc41` |
| personnel | `2895672b-5349-4ac6-a505-a6aad98c3495` |
| parametres | `3fc46cf9-571e-4482-b2e7-d25a087d707c` |
| rapports | `f8a138c4-b695-443f-aefc-8cd94c54eb28` |
| taches_perso_dr (private) | `840fa987-9a85-4bc8-b17c-5f9cf39f06f5` |

## 3. Supabase schema (mirror + app tables)

**Mirror tables** (one per Notion DB, keyed by `notion_id` = page UUID). All Notion fields kept — including `Lien Doctolib`, `Nom complet`, phones, emails, PSID, etc. Relations stored as `text[]` of Notion page ids + resolved FK columns where useful.

**App tables:**
- `app_members` — auth_user_id, email, personnel_notion_id, role (`admin` | `medecin` | `secretaire` | `ipa` | `externe`), is_owner (Dr. Amraoui flag), active.
- `app_permissions` — matrix: role × area → allowed (bool) + level (`none` | `status` | `full` for payments). Editable from Admin UI.
- `sync_runs` — id, started_at, finished_at, status, table, rows_upserted, error. Drives the sync-health banner.

**RLS:**
- All mirror tables: read allowed per role via `app_permissions` lookup; doctors additionally scoped to rows where `medecin_assigne` contains their `personnel_notion_id` (patients, dossiers, paiements) or `responsable` contains it (taches).
- `taches` with `domaine = 'Personnel'` created by the owner: visible only to owner + admin.
- `taches_perso_dr`: owner + admin only.
- Writes: only via server routes (service role); no direct client writes to mirror tables.

## 4. Access model

- Admin screen: **matrix grid** (roles × areas, checkboxes) + **members list** (email, role, Notion name mapping, active toggle).
- **Create member:** admin enters email → server route (service role) creates Supabase auth user with a **generated password** → password shown once to admin → admin sends it to the member. Role + matrix set on same screen.
- **Active off** → sign-out enforced by middleware check on `app_members.active`.
- Doctor scope = automatic from Notion `Médecin assigné` relation. No manual assignment.

## 5. Screens (all French, labels copied from Notion)

| Route | Who | Content |
|---|---|---|
| `/connexion` | all | email + password login |
| `/` | all | redirect by role |
| `/secretariat` | secrétaire, admin, owner | 📥 À traiter (dossiers to verify) · 📅 RDV aujourd'hui/à venir · ⚠️ Infos manquantes · ✅ Mes tâches · 🦾 Appareils à suivre · 💳 Paiements à suivre. Actions: verify dossier, change intake status, record payment, chase device |
| `/medecin` | médecin, owner | 🩺 À traiter maintenant (only dossiers with `Visible médecin` = true, only theirs) · 👥 Mes patients · 🟣 Mes tâches · exams to interpret. Owner sees a doctor-picker (herself by default) |
| `/patients` + `/patients/[id]` | per matrix | list with search (name, PSID); detail: identity (Nom, Nom complet, PSID, phones, emails, **Lien Doctolib**, Lien dossier sécurisé), statut, vigilance, problème principal, RDV dates, médecin assigné, tabs: Dossiers / Examens / Paiements (running balance: payé X — reste Y — statut) / Perfusions / Tâches |
| `/taches` | all | list (filters: statut, domaine, responsable) + create/edit. Recurring (`Récurrente` + récurrence) & one-off. Default responsable = Dr. Amraoui. `Personnel` domain = private to owner |
| `/finances` | admin, owner | per-doctor month summary: nb patients + **total facturé** (billed; default per open question) · payments table with method + status · unpaid queue |
| `/admin` | admin, owner | stats mirroring Notion Administration page (patients actifs, dossiers en attente, appareils en retard, total encaissé, breakdowns) · **sync-health banner** (last sync, "Synchroniser maintenant" button, log view) |
| `/admin/acces` | admin, owner | permission matrix + members list + create member flow |

**Design:** clean light UI, cardio-red/blue accent, cards + tables, sidebar nav with the same emoji/section names as Notion (🟦 Secrétariat, 🩺 Médecin, ⚙️ Administration…), responsive, keyboard-friendly. shadcn/ui style components, Tailwind.

## 6. Payment rules

- One record per charge (as in Notion). Add **`Mode de paiement`** select (Carte / Espèces / Chèque / Virement) — the one missing field (added in Notion by us, synced like the rest).
- Balance always computed: `reste = montant_dû − montant_payé`. Never hand-entered.
- Associate doctors see **status only** (Payé/Partiel/Impayé) for their own patients by default (matrix cell `payments: status`); admin can flip to `full`.
- Finance totals = **billed** (`montant_dû` summed) by default; flagged as open question in UI copy ("Total facturé").

## 7. Out of scope (deliberate)

Commission calculator · notification engine (n8n owns it) · per-secretary logins · medical detail fields · her personal Notion space / Claude agent integration · VPS.

## 8. Pass criteria & tests

### Sync
- ✅ First full sync copies every row of all 10 databases into Supabase; row counts match Notion (spot-check ≥3 tables).
- ✅ Editing a row in Notion appears in the app after next sync (≤10 min or manual sync).
- ✅ Sync failure (bad token) is recorded in `sync_runs` and surfaces in the admin banner; app keeps serving last good data.
- Test: unit tests for property-mapper (every Notion property type used → correct column value, incl. dates, selects, multi-selects, relations, rollup skip); integration test with recorded Notion JSON fixture.

### Auth & access
- ✅ Admin creates member → password displayed once → member can log in with it.
- ✅ Deactivated member is blocked at next request (middleware).
- ✅ Doctor sees only their own patients/dossiers/tasks (RLS verified with two doctor accounts).
- ✅ Dossier with `Visible médecin` = false never appears on `/medecin` (checked at DB policy level, not just UI).
- ✅ `Personnel`-domain tasks of the owner invisible to every other role.
- ✅ Matrix change (e.g. untick secretary → finance) takes effect without redeploy.
- Test: RLS test suite (SQL) running as each role; e2e login/role-routing tests.

### Screens
- ✅ Secretary can: verify a dossier (→ becomes visible to doctor), change intake status, mark device returned, record a payment with method, see unpaid queue.
- ✅ Doctor can: open a verified dossier, mark statut médecin, complete a task, see patient detail incl. Doctolib link (clickable).
- ✅ Patient search by name and PSID returns correct record.
- ✅ Task create with no assignee defaults to Dr. Amraoui; recurring task shows récurrence.
- ✅ Finance page: per-doctor patient count + billed total for selected month equals a hand-computed sum from Supabase rows.
- ✅ Every write lands in Notion (verify row in Notion after action).
- Test: e2e happy-path per role (Playwright) + manual checklist before hand-off.

### Quality bar
- ✅ All labels French, matching Notion vocabulary exactly.
- ✅ Loads in <2s on Vercel; usable on a laptop and tablet.
- ✅ No Notion call in any read path.

## 9. Build order

1. Scaffold Next.js + Tailwind + shadcn-style UI kit, layout, French nav.
2. Supabase SQL migrations (mirror tables, app tables, RLS, seed matrix).
3. Sync engine (`/api/sync` + property mapper + cron config + manual trigger).
4. Auth + members + matrix (login, middleware, admin create-member with generated password).
5. Screens: secrétariat → médecin → patients → tâches → finances → admin.
6. Write-backs to Notion (dossier verify, task CRUD, payment record, device return).
7. Tests (mapper unit, RLS suite, e2e happy paths) + polish + deploy checklist.

## 10. What I need from you

1. **Supabase project** (you said you'll create it): URL + anon key + service-role key.
2. **Notion integration token** with access to the Cockpit pages (internal integration, shared with the Cockpit).
3. Answers when available: doctors see payment **amounts or status only** (default: status) · finance total **billed or collected** (default: billed).
