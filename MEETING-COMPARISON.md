# Cockpit Dr Amraoui — Final plan

*July 7, 2026 · decisions locked with Esubalew. This is the build contract.*

---

## 1. The system in one picture

```
Notion (source of truth, the Dr can always look here)
   ▲ every write goes here FIRST          │ sync every 10 min + manual button
   │                                      ▼
Web app (what the team actually uses) ← reads ONLY from → Supabase (fast copy + access control)
n8n (notifications: task emails, Google Calendar invites, overdue alerts, patient emails)
```

- Notion is the ledger. Supabase is the screen. n8n is the messenger.
- The app never reads from Notion → rate limits can never freeze the screen.
- Who-sees-what is enforced in the database (RLS), controllable from the admin matrix.

---

## 2. Decisions taken (July 7, with Esubalew)

| # | Decision |
|---|----------|
| D1 | **Doctors see full payment info** for their own patients: amount due, paid, remaining, method, status. Default = ON, still switchable per role in the admin matrix |
| D2 | **Finances page stays as is** (billed + collected + remaining per doctor). No commission logic for now — revisit after client review |
| D3 | **Shared task pool**: a task created without an explicit assignee is owned by **Dr Amraoui by default** AND flagged "À prendre" in the shared pool. Anyone can claim it ("Je m'en occupe" → it becomes theirs) or the owner can reassign it. Explicitly assigning another person keeps the task out of the pool. One-click ✓ completion on every row |
| D4 | **Notifications stay in n8n**, extended: (a) keep French task emails, (b) add a Google Calendar invite to the assigned person as reminder, (c) a checker that detects tasks past due and notifies the whole team |

---

## 3. What the web app does for the clinic, day to day

**The dossier flow (the spine of the clinic):**
Doctolib/phone booking → appears in the secretary's "À traiter" → secretary completes and clicks **Vérifier ✓** → dossier becomes visible to the assigned doctor → doctor reads, updates status to Terminé → payment collected by the secretary → totals appear in Finances. Every step written to Notion instantly.

**Task management (D3 — the shared pool):**
- One global task list everyone sees: what's open, what's claimed, what's done.
- Anyone creates a task; assigning a person is optional.
- Unassigned = "À prendre" (up for grabs). One click **"Je m'en occupe"** claims it. One click **✓** completes it.
- Sidebar badges + a "today" strip on every home page: "3 tâches aujourd'hui · 2 en retard".
- n8n emails the assignee (French, with the Notion link), sends a Google Calendar invite, and if the task passes its due date unfinished, alerts the whole team (D4).
- Recurring tasks (daily/weekly/monthly…) supported.
- Private domain "Personnel" visible only to the Dr and admin.

**Device (Holter) tracking:** its own page — to interpret / to send / devices out with expected return dates; one click "Marquer rendu". Never mixed into the general task list.

**Money:** secretary collects with "Encaisser" (amount + method; status and balance computed, never typed). Doctors see their patients' full payment info (D1). The Dr sees per-doctor monthly totals (D2).

---

## 4. Who can do what (final)

### Dr Amraoui / Admin
- Sees **everything**: dashboard stats, all tasks (incl. her private list), all patients/dossiers, finances per doctor, sync health.
- Creates/assigns/claims/completes/deletes tasks. Views the app as any doctor (selector).
- Creates and disables accounts, resets passwords, flips any permission in the matrix.
- Can always fall back to Notion — it is never behind.

### Secretary (one shared login)
- One home page with the whole day: dossiers to verify, today's RDVs, missing info, devices out, payments to collect, open tasks.
- Verifies dossiers (the act that unlocks them for doctors), creates patients and tasks, claims pool tasks, collects payments, marks devices returned.
- Cannot see: finances totals, admin, accounts, the Dr's private tasks.

### Assigned doctor
- Sees only **verified** dossiers of **their** patients, their tasks + the shared pool, their patients, exams waiting for them.
- Sees **full payment info of their own patients** (D1): due, paid, remaining, method, status.
- Updates dossier statuses, claims/completes tasks, creates tasks, searches patients.
- Cannot see: other doctors' patients, unverified dossiers (blocked at DB level), clinic-wide finances, admin.

---

## 5. Build list (in order)

**Now — web app (small, ~1 day):**
1. One-click **✓ complete** on every task row (toast + Undo).
2. **Pool**: "À prendre" filter + "Je m'en occupe" claim button; unassigned tasks stop defaulting to the Dr.
3. **Badges + "today" strip** in sidebar and home pages.
4. **Delete task** (archive in Notion, confirm dialog, admin/owner only) — Maneesh's checklist item.
5. Flip matrix default: `paiements_own = full` for doctors (D1).
6. Write-retry with backoff on Notion 429 (invisible insurance).

**Now — n8n (no app code):**
7. Google Calendar invite on task assignment (D4b).
8. Overdue checker → team notification (D4c). Keep existing task emails (D4a).

**Then — go live:** deploy to Vercel (env vars + 10-min cron already configured), create the real team accounts from Accès et comptes.

**Later, only when needed:** delta sync (when sync > 30s), write queue (if 429s become frequent), webhooks, kanban view, daily checklist, Doctolib export.

---

## 6. Still open (after client review)

- Commission calculation on Finances (D2 — deliberately parked).
- Daily automated checklist + Doctolib export upload (agreed Jul 3, scoped after go-live).
