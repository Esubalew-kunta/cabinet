# Cockpit Dr Amraoui — Web App

Application web du cabinet **Cardio Check-Up** (Dr Amraoui). Notion reste le back-office ;
Supabase est la copie fiable que l'app lit ; l'équipe n'ouvre jamais Notion.

```
Notion (cockpit) ──sync (cron 10 min + bouton)──► Supabase ──lecture──► Next.js (Vercel)
      ▲                                                                    │
      └──────────── écritures unitaires (API Notion) ◄─────────────────────┘
```

- **Lectures** : toujours Supabase (rapide, pas de rate-limit Notion).
- **Écritures** (vérifier un dossier, tâche, encaissement…) : Notion d'abord (source de vérité),
  puis miroir Supabase optimiste.
- **Accès** : matrice rôles × zones, modifiable depuis l'app (`/admin/acces`), appliquée par RLS.
- **Portail médecin** : un dossier n'est visible au médecin que si `Visible médecin` est coché
  (posé par « Vérifier ✓ » côté secrétariat) — imposé au niveau base (RLS), pas seulement UI.

## Mise en route

### 1. Supabase
1. Créer le projet (organisation Gromit, plan Pro).
2. SQL Editor → exécuter `supabase/migrations/001_init.sql`.
3. Récupérer : `Project URL`, `anon key`, `service_role key` (Settings → API).

### 2. Notion
1. Créer une **integration interne** (https://www.notion.so/profile/integrations) → token `ntn_…`.
2. Partager la page **Cockpit Dr Amraoui** (et donc toutes ses bases) avec l'integration
   (Page → ⋯ → Connections → l'integration).
3. Dans la base **Paiements**, ajouter une propriété **select** `Mode de paiement`
   avec les options : `Carte`, `Espèces`, `Chèque`, `Virement` (seul champ nouveau).

### 3. Variables d'environnement
Copier `.env.example` → `.env.local` et remplir :

| Variable | Rôle |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client (RLS active) |
| `SUPABASE_SERVICE_ROLE_KEY` | serveur uniquement (sync, comptes, écritures) |
| `NOTION_TOKEN` | sync + écritures Notion |
| `CRON_SECRET` | protège `/api/sync` (Vercel Cron l'envoie automatiquement) |

### 4. Premier démarrage
```bash
npm install
npm run dev
```
1. Créer le **premier compte admin à la main** (une seule fois) :
   - Supabase → Authentication → Add user (email + mot de passe, « Auto Confirm »).
   - SQL : `insert into app_members (auth_user_id, email, nom, role, is_owner, active)
     values ('<uid>', '<email>', 'Admin', 'admin', false, true);`
2. Se connecter → **Administration → Synchroniser maintenant** (premier pull complet).
3. `/admin/acces` → créer les autres comptes (le mot de passe généré s'affiche une fois,
   le copier et l'envoyer au membre). Compte **Dr Amraoui** : cocher « Propriétaire » et lier
   sa fiche Personnel. Secrétaires : **un seul compte partagé** (décision d'équipe).

### 5. Déploiement (Vercel)
1. Pousser le repo, importer dans Vercel, définir les 5 variables d'env.
2. `vercel.json` programme déjà le cron `/api/sync` toutes les 10 min
   (définir `CRON_SECRET` dans Vercel pour qu'il soit accepté).

## Tests

```bash
npm test        # mapper Notion → lignes (11 tests)
npm run lint    # ESLint + règles React strictes
npm run build   # build de prod
```

### Checklist manuelle avant remise (critères d'acceptation)
- [ ] Sync : compte de lignes Notion = Supabase (patients, dossiers, paiements).
- [ ] Une modif dans Notion apparaît après « Synchroniser maintenant ».
- [ ] Admin crée un membre → mot de passe affiché une fois → connexion OK.
- [ ] Membre désactivé → rejeté à la prochaine requête.
- [ ] Un médecin ne voit que ses patients/dossiers/tâches (tester avec 2 comptes).
- [ ] Dossier non « Vérifié » invisible pour le médecin (RLS, pas seulement UI).
- [ ] Tâches domaine « Personnel » invisibles hors Dre/admin.
- [ ] Secrétaire : vérifier dossier → il apparaît chez le médecin ; encaisser → statut recalculé.
- [ ] Chaque écriture est visible dans Notion.
- [ ] Fiche patient : lien Doctolib cliquable, PSID, téléphones, emails, solde calculé.
- [ ] Finances : totaux par médecin = somme manuelle des paiements du mois.

## Structure

```
supabase/migrations/001_init.sql   schéma complet + RLS + matrice par défaut
src/lib/notion/sources.ts          ids des 10 bases Notion + mapping propriétés
src/lib/notion/mapper.ts           mapper pur (testé)
src/lib/notion/sync.ts             pull complet → upsert + suppression + journal
src/lib/actions.ts                 écritures (Notion → miroir Supabase)
src/lib/auth.ts                    session, permissions, redirections par rôle
src/app/(app)/…                    écrans : secretariat, medecin, patients,
                                   taches, examens, perfusions, finances,
                                   admin, admin/acces
src/app/api/sync|membres|matrice   routes serveur (service role)
src/proxy.ts                       auth guard (Next 16 : proxy = ex-middleware)
```

## Décisions produit reprises telles quelles
- Tâche sans responsable → **Dr Amraoui** par défaut.
- **Pas de calcul de commission** — totaux facturés par médecin uniquement.
- Médecins associés : **statut** de paiement de leurs patients (montants = case matrice à activer).
- Pas de moteur de notifications (n8n s'en charge), pas de détail médical, pas de VPS.

## Questions encore ouvertes (à trancher avec Maneesh / la Dre)
1. Médecins : montants ou statut seul ? (défaut actuel : statut — 1 clic dans la matrice pour changer)
2. Total par médecin : facturé ou encaissé ? (défaut : facturé, l'encaissé est affiché à côté)
