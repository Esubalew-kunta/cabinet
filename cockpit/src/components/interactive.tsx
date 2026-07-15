"use client";

/**
 * Composants interactifs branchés sur les server actions.
 * Chaque action retourne { ok } | { ok:false, error } : l'erreur est affichée
 * inline, le succès déclenche un toast. Les VALEURS envoyées à Notion restent
 * en français ; seul l'affichage est traduit (tv).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Field } from "@/components/ui/input";
import {
  MODES_PAIEMENT,
  MOTIFS_DOSSIER,
  SOURCES_DOSSIER,
  SITES,
  INDICATIONS_EXAMEN,
  TYPES_APPAREIL,
  SOCIETES_APPAREILLAGE,
  ETAT_APPAREIL_UNITE,
  CAT_EXAMEN,
  CONCLUSION_EXAMEN,
  STATUT_CR,
  CATEGORIES_STOCK,
  UNITES_STOCK,
  CATEGORIES_TACHE,
  RECURRENCES,
} from "@/lib/labels";
import { tv, RECURRENCE } from "@/lib/i18n/dict";
import { uniteDisponible, prochaineDisponibilite, type Pret } from "@/lib/appareils";
import { useTr } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import { ArrowDownToLine, ArrowUpFromLine, Check, CheckCheck, CreditCard, Euro, FolderPlus, Hand, History, Link2, Microscope, Minus, Package, Pencil, Plus, Repeat, Send, Stethoscope, Syringe, Trash2, UserPlus, Watch } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import {
  verifierDossier,
  devérifierDossier,
  setStatutIntake,
  setStatutMedecin,
  setStatutTache,
  annulerTerminee,
  reassignerTache,
  prendreTache,
  supprimerTache,
  creerTache,
  majTache,
  arreterRecurrence,
  creerPatient,
  majPatientInfos,
  enregistrerPaiement,
  creerPaiement,
  appareilRendu,
  assignerMedecin,
  creerDossier,
  setStatutCR,
  setLienCR,
  setOrdonnanceRemise,
  creerExamen,
  creerAppareil,
  setEtatAppareil,
  interpreterExamen,
  envoyerExamen,
  setCAT,
  majAppareillage,
  facturerPenalite,
  creerPerfusion,
  majPerfusion,
  creerArticle,
  mouvementStock,
  setSeuilArticle,
  setParametre,
} from "@/lib/actions";
import type { Appareil, Article, Examen, Mouvement, Perfusion, Tache } from "@/lib/types";

type Result = { ok: true } | { ok: false; error: string };

function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();
  const run = (fn: () => Promise<Result>, onDone?: () => void, successMessage?: string) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else {
        onDone?.();
        if (successMessage) toast(successMessage);
        router.refresh();
      }
    });
  return { pending, error, run, setError };
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mt-1 rounded bg-danger-soft px-2 py-1 text-xs text-danger">{error}</p>;
}

/* ---------- Dossiers ---------- */

export function VerifierDossierButton({ dossierId, verified }: { dossierId: string; verified?: boolean }) {
  const { pending, error, run } = useAction();
  const { tr } = useTr();
  return (
    <div>
      {verified ? (
        <Button
          size="sm"
          variant="secondary"
          loading={pending}
          onClick={() => run(() => devérifierDossier(dossierId), undefined, tr.toast.saved)}
        >
          <CheckCheck className="size-3.5" /> {tr.dialogs.unverify}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="success"
          loading={pending}
          onClick={() => run(() => verifierDossier(dossierId), undefined, tr.toast.dossierVerified)}
        >
          <CheckCheck className="size-3.5" /> {tr.dialogs.verify}
        </Button>
      )}
      <ErrorText error={error} />
    </div>
  );
}

export function StatutSelect({
  id,
  value,
  options,
  kind,
}: {
  id: string;
  value: string | null;
  options: string[];
  kind: "intake" | "medecin" | "tache";
}) {
  const { pending, error, run } = useAction();
  const { lang, tr } = useTr();
  const fn = kind === "intake" ? setStatutIntake : kind === "medecin" ? setStatutMedecin : setStatutTache;
  return (
    <div>
      <Select
        className="h-7 w-auto text-xs"
        value={value ?? ""}
        disabled={pending}
        onChange={(e) => run(() => fn(id, e.target.value), undefined, tr.toast.saved)}
      >
        {!value && <option value="">{tr.common.empty}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {tv(lang, o)}
          </option>
        ))}
      </Select>
      <ErrorText error={error} />
    </div>
  );
}

/* ---------- Tâches ---------- */

export function ReassignerSelect({
  tacheId,
  value,
  personnel,
}: {
  tacheId: string;
  value: string | null;
  personnel: { notion_id: string; nom: string | null }[];
}) {
  const { pending, error, run } = useAction();
  const { tr } = useTr();
  return (
    <div>
      <Select
        className="h-7 w-auto text-xs"
        value={value ?? ""}
        disabled={pending}
        onChange={(e) => e.target.value && run(() => reassignerTache(tacheId, e.target.value), undefined, tr.toast.saved)}
      >
        <option value="">{tr.common.notAssigned}</option>
        {personnel.map((p) => (
          <option key={p.notion_id} value={p.notion_id}>
            {p.nom}
          </option>
        ))}
      </Select>
      <ErrorText error={error} />
    </div>
  );
}

export function NouvelleTacheButton({
  personnel,
  patients,
  defaultPatient,
  defaultDossier,
  ownerId,
}: {
  personnel: { notion_id: string; nom: string | null }[];
  patients?: { notion_id: string; nom: string | null }[];
  defaultPatient?: string;
  defaultDossier?: string;
  ownerId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { lang, tr } = useTr();
  const [titre, setTitre] = useState("");
  const [echeance, setEcheance] = useState("");
  const [priorite, setPriorite] = useState("Normale");
  const [categorie, setCategorie] = useState("");
  const [recurrente, setRecurrente] = useState(false);
  const [recurrence, setRecurrence] = useState<string>("weekly");
  const [note, setNote] = useState("");
  // Propriétaire par défaut = Dr Amraoui (owner) : présélectionnée si connue,
  // sinon on retombe sur l'option vide que le serveur résout vers l'owner.
  const owner = ownerId ? personnel.find((p) => p.notion_id === ownerId) : undefined;
  const [responsable, setResponsable] = useState(owner ? owner.notion_id : "");
  const [patient, setPatient] = useState(defaultPatient ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Le motif d'une récurrence EST l'échéance (pas de sélecteur de jour) : sans échéance,
    // rien à répéter. Bloqué ici pour un message immédiat ; le serveur revérifie.
    if (recurrente && !echeance) {
      setError(tr.dialogs.recurrenceNeedsDue);
      return;
    }
    run(
      () =>
        creerTache({
          titre,
          echeance: echeance || null,
          priorite,
          categorie: categorie || null,
          calendrier: recurrente ? "Récurrente" : "Ponctuelle",
          recurrence: recurrente ? recurrence : null,
          note: note || null,
          responsable: responsable || null,
          patient: patient || null,
          dossier: defaultDossier || null,
        }),
      () => {
        setOpen(false);
        setTitre("");
        setEcheance("");
        setNote("");
        setCategorie("");
        setRecurrente(false);
      },
      tr.toast.taskCreated
    );
  }

  return (
    <>
      <Button size="sm" onClick={() => { setError(null); setOpen(true); }}>
        <Plus className="size-3.5" /> {tr.dialogs.newTask}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tr.dialogs.newTask} icon={<Plus />}>
        <form onSubmit={submit} className="space-y-3">
          <Field label={tr.dialogs.taskTitle}>
            <Input value={titre} onChange={(e) => setTitre(e.target.value)} placeholder={tr.dialogs.taskPlaceholder} required autoFocus />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr.common.due}>
              <Input type="datetime-local" value={echeance} onChange={(e) => setEcheance(e.target.value)} />
            </Field>
            <Field label={tr.common.priority}>
              <Select value={priorite} onChange={(e) => setPriorite(e.target.value)}>
                {["Normale", "À revoir", "Urgent"].map((p) => (
                  <option key={p} value={p}>{tv(lang, p)}</option>
                ))}
              </Select>
            </Field>
            <Field label={tr.dialogs.categoryField}>
              <Select value={categorie} onChange={(e) => setCategorie(e.target.value)}>
                <option value="">{tr.common.none}</option>
                {CATEGORIES_TACHE.map((c) => (
                  <option key={c} value={c}>{tv(lang, c)}</option>
                ))}
              </Select>
            </Field>
            <Field label={tr.dialogs.ownerField} hint={tr.dialogs.ownerHint}>
              <Select value={responsable} onChange={(e) => setResponsable(e.target.value)}>
                {owner ? (
                  <>
                    <option value={owner.notion_id}>{owner.nom} {tr.dialogs.ownerDefaultSuffix}</option>
                    {personnel
                      .filter((p) => p.notion_id !== owner.notion_id)
                      .map((p) => (
                        <option key={p.notion_id} value={p.notion_id}>
                          {p.nom}
                        </option>
                      ))}
                  </>
                ) : (
                  <>
                    <option value="">{tr.dialogs.ownerDefault}</option>
                    {personnel.map((p) => (
                      <option key={p.notion_id} value={p.notion_id}>
                        {p.nom}
                      </option>
                    ))}
                  </>
                )}
              </Select>
            </Field>
            {patients && (
              <Field label={tr.dialogs.linkedPatient}>
                <Select value={patient} onChange={(e) => setPatient(e.target.value)}>
                  <option value="">{tr.common.none}</option>
                  {patients.map((p) => (
                    <option key={p.notion_id} value={p.notion_id}>
                      {p.nom}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          <Field label={tr.dialogs.noteField}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr.dialogs.notePlaceholder} />
          </Field>

          {/* Récurrence : le motif vient de l'échéance (« tous les lundis » = échéance un lundi). */}
          <div className="rounded-lg border border-border p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={recurrente}
                onChange={(e) => setRecurrente(e.target.checked)}
                className="size-4 accent-current"
              />
              <Repeat className="size-3.5 text-muted" />
              {tr.dialogs.recurringLabel}
            </label>
            {recurrente && (
              <div className="mt-3 space-y-2">
                <Field label={tr.dialogs.recurrenceEvery} hint={tr.dialogs.recurrenceHint}>
                  <Select value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
                    {RECURRENCES.map((r) => (
                      <option key={r} value={r}>{RECURRENCE[lang][r]}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
          </div>

          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tr.common.cancel}
            </Button>
            <Button type="submit" loading={pending}>
              {tr.dialogs.createTask}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Édition d'une tâche (titre, échéance, priorité, catégorie, note) depuis sa fiche. */
export function ModifierTacheButton({
  tache,
}: {
  tache: Pick<Tache, "notion_id" | "titre" | "echeance" | "priorite" | "note" | "categorie">;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { lang, tr } = useTr();
  const [titre, setTitre] = useState(tache.titre ?? "");
  const [echeance, setEcheance] = useState(tache.echeance ? tache.echeance.slice(0, 16) : "");
  const [priorite, setPriorite] = useState(tache.priorite ?? "Normale");
  const [categorie, setCategorie] = useState(tache.categorie ?? "");
  const [note, setNote] = useState(tache.note ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        majTache(tache.notion_id, {
          titre,
          echeance: echeance || null,
          priorite,
          categorie: categorie || null,
          note: note || null,
        }),
      () => setOpen(false),
      tr.toast.saved
    );
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setError(null); setOpen(true); }}>
        <Pencil className="size-3.5" /> {tr.common.edit}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tr.common.edit} icon={<Pencil />}>
        <form onSubmit={submit} className="space-y-3">
          <Field label={tr.dialogs.taskTitle}>
            <Input value={titre} onChange={(e) => setTitre(e.target.value)} required autoFocus />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr.common.due}>
              <Input type="datetime-local" value={echeance} onChange={(e) => setEcheance(e.target.value)} />
            </Field>
            <Field label={tr.common.priority}>
              <Select value={priorite} onChange={(e) => setPriorite(e.target.value)}>
                {["Normale", "À revoir", "Urgent"].map((p) => (
                  <option key={p} value={p}>{tv(lang, p)}</option>
                ))}
              </Select>
            </Field>
            <Field label={tr.dialogs.categoryField}>
              <Select value={categorie} onChange={(e) => setCategorie(e.target.value)}>
                <option value="">{tr.common.none}</option>
                {CATEGORIES_TACHE.map((c) => (
                  <option key={c} value={c}>{tv(lang, c)}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={tr.dialogs.noteField}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr.dialogs.notePlaceholder} />
          </Field>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{tr.common.cancel}</Button>
            <Button type="submit" loading={pending}>{tr.common.save}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Un clic = Terminé, avec « Annuler » dans le toast (revient au statut d'avant). */
export function TacheTermineeButton({ tacheId, statut }: { tacheId: string; statut: string | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();
  const { tr } = useTr();

  function done() {
    start(async () => {
      setError(null);
      const res = await setStatutTache(tacheId, "Terminé");
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // On passe l'instance engendrée : annuler doit AUSSI la retirer, sinon la série se
      // retrouve avec deux tâches ouvertes.
      const suivanteId = res.suivanteId;
      toast(tr.toast.taskDone, "success", {
        label: tr.common.undo,
        onAction: async () => {
          await annulerTerminee(tacheId, statut ?? "À faire", suivanteId);
          router.refresh();
        },
      });
      router.refresh();
    });
  }

  return (
    <div>
      <button
        onClick={done}
        disabled={pending}
        title={tr.taches.markDone}
        aria-label={tr.taches.markDone}
        className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md border border-border bg-surface text-muted shadow-sm transition-all hover:border-success/40 hover:bg-success-soft hover:text-success active:scale-95 disabled:opacity-50"
      >
        <Check className="size-4" />
      </button>
      <ErrorText error={error} />
    </div>
  );
}

/** « Je m'en occupe » : réassigne la tâche du pool au membre connecté. */
export function PrendreTacheButton({ tacheId }: { tacheId: string }) {
  const { pending, error, run } = useAction();
  const { tr } = useTr();
  return (
    <div>
      <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => prendreTache(tacheId), undefined, tr.toast.taskClaimed)}>
        <Hand className="size-3.5" /> {tr.taches.claim}
      </Button>
      <ErrorText error={error} />
    </div>
  );
}

/** Suppression (admin/owner) avec confirmation : archive dans Notion. */
export function SupprimerTacheButton({ tacheId }: { tacheId: string }) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { tr } = useTr();

  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true); }}
        title={tr.taches.deleteTitle}
        aria-label={tr.taches.deleteTitle}
        className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-danger-soft hover:text-danger"
      >
        <Trash2 className="size-4" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tr.taches.deleteTitle} icon={<Trash2 />}>
        <div className="space-y-4">
          <p className="text-sm">{tr.taches.deleteConfirm}</p>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>{tr.common.cancel}</Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => run(() => supprimerTache(tacheId), () => setOpen(false), tr.toast.taskDeleted)}
            >
              {tr.common.confirmDelete}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/**
 * Arrête la récurrence d'une tâche.
 * Seule façon de terminer une série : sans ça, clôturer une instance en engendre
 * une autre indéfiniment.
 */
export function ArreterRecurrenceButton({ tacheId }: { tacheId: string }) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { tr } = useTr();

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setError(null); setOpen(true); }}>
        <Repeat className="size-3.5" /> {tr.dialogs.stopRecurrence}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tr.dialogs.stopRecurrence} icon={<Repeat />}>
        <div className="space-y-4">
          <p className="text-sm">{tr.dialogs.stopRecurrenceConfirm}</p>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>{tr.common.cancel}</Button>
            <Button
              loading={pending}
              onClick={() => run(() => arreterRecurrence(tacheId), () => setOpen(false), tr.toast.saved)}
            >
              {tr.dialogs.stopRecurrence}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/* ---------- Patients ---------- */

export function NouveauPatientButton({
  medecins,
  problemes,
  ownerId,
}: {
  medecins: { notion_id: string; nom: string | null }[];
  problemes: string[];
  ownerId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { tr } = useTr();
  // Médecin par défaut = Dr Amraoui (owner) si sa fiche est proposée.
  const defaultMedecin = ownerId && medecins.some((m) => m.notion_id === ownerId) ? ownerId : "";
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [naissance, setNaissance] = useState("");
  const [telephone, setTelephone] = useState("");
  const [email, setEmail] = useState("");
  const [probleme, setProbleme] = useState("");
  const [medecin, setMedecin] = useState(defaultMedecin);
  const [doctolib, setDoctolib] = useState("");
  const [notes, setNotes] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        creerPatient({
          prenom: prenom || null,
          nom,
          date_naissance: naissance || null,
          telephone: telephone || null,
          email: email || null,
          probleme_principal: probleme || null,
          medecin: medecin || null,
          lien_doctolib: doctolib || null,
          notes_secretariat: notes || null,
        }),
      () => {
        setOpen(false);
        setPrenom(""); setNom(""); setNaissance(""); setTelephone(""); setEmail(""); setDoctolib(""); setNotes("");
      },
      tr.toast.patientCreated
    );
  }

  return (
    <>
      <Button size="sm" onClick={() => { setError(null); setOpen(true); }}>
        <Plus className="size-3.5" /> {tr.dialogs.newPatient}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tr.dialogs.newPatient} icon={<UserPlus />}>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr.dialogs.firstName}>
              <Input value={prenom} onChange={(e) => setPrenom(e.target.value)} autoFocus placeholder={tr.dialogs.firstNamePlaceholder} />
            </Field>
            <Field label={tr.dialogs.lastName}>
              <Input value={nom} onChange={(e) => setNom(e.target.value)} required placeholder={tr.dialogs.lastNamePlaceholder} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr.dialogs.birthDate}>
              <Input type="date" value={naissance} onChange={(e) => setNaissance(e.target.value)} />
            </Field>
            <Field label={tr.dialogs.phone}>
              <Input value={telephone} onChange={(e) => setTelephone(e.target.value)} placeholder="+33…" />
            </Field>
            <Field label={tr.dialogs.email}>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label={tr.dialogs.mainProblem}>
              <Select value={probleme} onChange={(e) => setProbleme(e.target.value)}>
                <option value="">{tr.common.empty}</option>
                {problemes.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
            </Field>
            <Field label={tr.dialogs.assignedDoctor} hint={tr.dialogs.doctorHint}>
              <Select value={medecin} onChange={(e) => setMedecin(e.target.value)}>
                <option value="">{tr.common.empty}</option>
                {medecins.map((m) => (
                  <option key={m.notion_id} value={m.notion_id}>
                    {m.nom}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={tr.dialogs.doctolibLink}>
            <Input type="url" value={doctolib} onChange={(e) => setDoctolib(e.target.value)} placeholder="https://www.doctolib.fr/…" />
          </Field>
          <Field label={tr.dialogs.secretaryNotes}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tr.dialogs.secretaryNotesPlaceholder} />
          </Field>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tr.common.cancel}
            </Button>
            <Button type="submit" loading={pending}>
              {tr.dialogs.createPatient}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function AssignerMedecinSelect({
  patientId,
  value,
  medecins,
}: {
  patientId: string;
  value: string | null;
  medecins: { notion_id: string; nom: string | null }[];
}) {
  const { pending, error, run } = useAction();
  const { tr } = useTr();
  return (
    <div>
      <Select
        className="h-7 w-auto text-xs"
        value={value ?? ""}
        disabled={pending}
        onChange={(e) => run(() => assignerMedecin(patientId, e.target.value || null), undefined, tr.toast.saved)}
      >
        <option value="">{tr.common.unassigned}</option>
        {medecins.map((m) => (
          <option key={m.notion_id} value={m.notion_id}>
            {m.nom}
          </option>
        ))}
      </Select>
      <ErrorText error={error} />
    </div>
  );
}

/* ---------- Paiements ---------- */

export function EncaisserButton({
  paiementId,
  montantDu,
  montantPaye,
}: {
  paiementId: string;
  montantDu: number | null;
  montantPaye: number | null;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { lang, tr } = useTr();
  const [montant, setMontant] = useState(String(montantDu ?? ""));
  const [mode, setMode] = useState<string>("Carte");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const total = (montantPaye ?? 0) + Number(montant || 0);
    run(
      () => enregistrerPaiement(paiementId, { montant_paye: total, mode_paiement: mode }),
      () => setOpen(false),
      tr.toast.paymentSaved
    );
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setError(null); setOpen(true); }}>
        {tr.dialogs.collect}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tr.dialogs.collectTitle} icon={<CreditCard />}>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr.dialogs.amountReceived}>
              <Input type="number" step="0.01" min="0" value={montant} onChange={(e) => setMontant(e.target.value)} required autoFocus />
            </Field>
            <Field label={tr.dialogs.paymentMode}>
              <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                {MODES_PAIEMENT.map((m) => (
                  <option key={m} value={m}>{tv(lang, m)}</option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="text-xs text-muted">{tr.dialogs.autoStatus}</p>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tr.common.cancel}
            </Button>
            <Button type="submit" loading={pending}>
              {tr.common.save}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function NouveauPaiementButton({
  patients,
  medecins,
}: {
  patients: { notion_id: string; nom: string | null }[];
  medecins: { notion_id: string; nom: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { lang, tr } = useTr();
  const [patient, setPatient] = useState("");
  const [type, setType] = useState("Consultation");
  const [du, setDu] = useState("");
  const [paye, setPaye] = useState("");
  const [mode, setMode] = useState("Carte");
  const [medecin, setMedecin] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        creerPaiement({
          patient,
          type_prestation: type,
          montant_du: Number(du || 0),
          montant_paye: Number(paye || 0),
          mode_paiement: Number(paye || 0) > 0 ? mode : null,
          responsable: medecin || null,
        }),
      () => {
        setOpen(false);
        setDu(""); setPaye("");
      },
      tr.toast.paymentSaved
    );
  }

  return (
    <>
      <Button size="sm" onClick={() => { setError(null); setOpen(true); }}>
        <Plus className="size-3.5" /> {tr.dialogs.newBilling}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tr.dialogs.newBilling} icon={<CreditCard />}>
        <form onSubmit={submit} className="space-y-3">
          <Field label={tr.common.patient}>
            <Select value={patient} onChange={(e) => setPatient(e.target.value)} required>
              <option value="">{tr.common.choose}</option>
              {patients.map((p) => (
                <option key={p.notion_id} value={p.notion_id}>
                  {p.nom}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr.dialogs.service}>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {["Consultation", "Bilan", "Holter", "Polygraphie", "Perfusion", "Autre"].map((t) => (
                  <option key={t} value={t}>{tv(lang, t)}</option>
                ))}
              </Select>
            </Field>
            <Field label={tr.common.doctor}>
              <Select value={medecin} onChange={(e) => setMedecin(e.target.value)}>
                <option value="">{tr.common.empty}</option>
                {medecins.map((m) => (
                  <option key={m.notion_id} value={m.notion_id}>
                    {m.nom}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tr.dialogs.amountDue}>
              <Input type="number" step="0.01" min="0" value={du} onChange={(e) => setDu(e.target.value)} required />
            </Field>
            <Field label={tr.dialogs.alreadyPaid}>
              <Input type="number" step="0.01" min="0" value={paye} onChange={(e) => setPaye(e.target.value)} placeholder="0" />
            </Field>
            <Field label={tr.dialogs.paymentMode}>
              <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                {MODES_PAIEMENT.map((m) => (
                  <option key={m} value={m}>{tv(lang, m)}</option>
                ))}
              </Select>
            </Field>
          </div>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tr.common.cancel}
            </Button>
            <Button type="submit" loading={pending}>
              {tr.common.save}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/* ---------- Examens ---------- */

export function AppareilRenduButton({ examenId }: { examenId: string }) {
  const { pending, error, run } = useAction();
  const { tr } = useTr();
  const [confirming, setConfirming] = useState(false);
  return (
    <div>
      {confirming ? (
        <div className="inline-flex items-center gap-1.5">
          <span className="text-xs text-muted">{tr.common.confirmQuestion}</span>
          <Button size="sm" loading={pending} onClick={() => run(() => appareilRendu(examenId), () => setConfirming(false), tr.toast.deviceReturned)}>
            {tr.common.yes}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>{tr.common.no}</Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
          {tr.dialogs.markReturned}
        </Button>
      )}
      <ErrorText error={error} />
    </div>
  );
}

/* ---------- Dossiers : création + compte rendu + référence ---------- */

export function NouveauDossierButton({
  patients,
  medecins,
  defaultPatient,
  parentDossier,
  variant = "primary",
  ownerId,
}: {
  patients: { notion_id: string; nom: string | null }[];
  medecins: { notion_id: string; nom: string | null; specialite?: string | null }[];
  defaultPatient?: string;
  parentDossier?: string;
  variant?: "primary" | "secondary";
  ownerId?: string | null; // médecin par défaut (Dr Amraoui)
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { lang, tr } = useTr();
  // Médecin par défaut = Dr Amraoui (owner) si sa fiche est dans la liste.
  const defaultMedecin = ownerId && medecins.some((m) => m.notion_id === ownerId) ? ownerId : "";
  const [patient, setPatient] = useState(defaultPatient ?? "");
  const [motif, setMotif] = useState(parentDossier ? "Avis chirurgical" : "Rythmologie");
  const [source, setSource] = useState("Téléphone");
  const [site, setSite] = useState<string>(SITES[0]);
  const [rdv, setRdv] = useState("");
  const [resume, setResume] = useState("");
  const [medecin, setMedecin] = useState(defaultMedecin);
  const [verifie, setVerifie] = useState(false);

  const isReferral = Boolean(parentDossier);
  const title = isReferral ? tr.dossierDetail.referral : tr.dialogs.newDossier;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        creerDossier({
          patient,
          motif,
          source: isReferral ? null : source,
          site,
          rendez_vous: rdv || null,
          resume: resume || null,
          medecin: medecin || null,
          dossier_parent: parentDossier || null,
          verifie,
        }),
      () => {
        setOpen(false);
        setRdv(""); setResume(""); setVerifie(false);
      },
      tr.toast.dossierCreated
    );
  }

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => { setError(null); setOpen(true); }}>
        <FolderPlus className="size-3.5" /> {title}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} icon={<FolderPlus />}>
        <form onSubmit={submit} className="space-y-3">
          {isReferral && <p className="text-xs text-muted">{tr.dossierDetail.referralSub}</p>}
          <Field label={tr.common.patient}>
            <Select value={patient} onChange={(e) => setPatient(e.target.value)} required disabled={Boolean(defaultPatient)}>
              <option value="">{tr.common.choose}</option>
              {patients.map((p) => (
                <option key={p.notion_id} value={p.notion_id}>{p.nom}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={isReferral ? tr.dossierDetail.referralMotif : tr.dialogs.motif}>
              <Select value={motif} onChange={(e) => setMotif(e.target.value)}>
                {MOTIFS_DOSSIER.map((m) => (
                  <option key={m} value={m}>{tv(lang, m)}</option>
                ))}
              </Select>
            </Field>
            {!isReferral && (
              <Field label={tr.dialogs.source}>
                <Select value={source} onChange={(e) => setSource(e.target.value)}>
                  {SOURCES_DOSSIER.map((s) => (
                    <option key={s} value={s}>{tv(lang, s)}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={tr.dialogs.site}>
              <Select value={site} onChange={(e) => setSite(e.target.value)}>
                {SITES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label={tr.dialogs.rdvDate}>
              <Input type="datetime-local" value={rdv} onChange={(e) => setRdv(e.target.value)} />
            </Field>
            <Field label={isReferral ? tr.dossierDetail.referralDoctor : tr.dialogs.assignedDoctor} hint={isReferral ? undefined : tr.dialogs.doctorHint}>
              <Select value={medecin} onChange={(e) => setMedecin(e.target.value)} required={isReferral}>
                <option value="">{isReferral ? tr.common.choose : tr.common.empty}</option>
                {medecins.map((m) => (
                  <option key={m.notion_id} value={m.notion_id}>
                    {m.nom}{m.specialite ? ` · ${tv(lang, m.specialite)}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={tr.dialogs.summary}>
            <Input value={resume} onChange={(e) => setResume(e.target.value)} placeholder={tr.dialogs.summaryPlaceholder} />
          </Field>
          {/* Bascule Vérifié : off = en attente (secrétaire seule), on = visible au médecin */}
          <label className="flex items-start gap-3 rounded-lg border border-border bg-surface/60 p-3 text-sm">
            <button
              type="button"
              role="switch"
              aria-checked={verifie}
              onClick={() => setVerifie((v) => !v)}
              className={cn("relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", verifie ? "bg-success" : "bg-border")}
            >
              <span className={cn("inline-block size-4 transform rounded-full bg-white shadow transition-transform", verifie ? "translate-x-4" : "translate-x-0.5")} />
            </button>
            <span>
              <span className="font-medium">{tr.dialogs.markVerified}</span>
              <span className="mt-0.5 block text-xs text-muted">{verifie ? tr.dialogs.verifiedOn : tr.dialogs.verifiedOff}</span>
            </span>
          </label>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{tr.common.cancel}</Button>
            <Button type="submit" loading={pending}>
              {isReferral ? tr.dossierDetail.referralCreate : tr.dialogs.createDossier}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function StatutCRSelect({ dossierId, value }: { dossierId: string; value: string | null }) {
  const { pending, error, run } = useAction();
  const { lang, tr } = useTr();
  return (
    <div>
      <Select
        className="h-7 w-auto text-xs"
        value={value ?? ""}
        disabled={pending}
        onChange={(e) => e.target.value && run(() => setStatutCR(dossierId, e.target.value), undefined, tr.toast.saved)}
      >
        {!value && <option value="">{tr.common.empty}</option>}
        {Object.keys(STATUT_CR).map((s) => (
          <option key={s} value={s}>{tv(lang, s)}</option>
        ))}
      </Select>
      <ErrorText error={error} />
    </div>
  );
}

export function LienCRButton({ dossierId, value }: { dossierId: string; value: string | null }) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { tr } = useTr();
  const [url, setUrl] = useState(value ?? "");
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setError(null); setUrl(value ?? ""); setOpen(true); }}>
        <Link2 className="size-3.5" /> {tr.dossierDetail.crSetLink}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tr.dossierDetail.crSetLink} icon={<Link2 />}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => setLienCR(dossierId, url), () => setOpen(false), tr.toast.saved);
          }}
          className="space-y-3"
        >
          <Field label={tr.dossierDetail.crLink}>
            <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" autoFocus />
          </Field>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{tr.common.cancel}</Button>
            <Button type="submit" loading={pending}>{tr.common.save}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function OrdonnanceToggle({ dossierId, value }: { dossierId: string; value: boolean }) {
  const { pending, error, run } = useAction();
  const { tr } = useTr();
  return (
    <div>
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value}
          disabled={pending}
          onChange={(e) => run(() => setOrdonnanceRemise(dossierId, e.target.checked), undefined, tr.toast.saved)}
          className="size-4 accent-[var(--color-primary)]"
        />
        {tr.dossierDetail.ordonnance}
      </label>
      <ErrorText error={error} />
    </div>
  );
}

/* ---------- Examens : pose, CAT, suivi appareillage, pénalité ---------- */

/**
 * Une unité du parc, avec ses prêts ouverts (en cours ET réservations à venir).
 *
 * `prets` est REQUIS, à dessein : la disponibilité se juge sur la date demandée, pas sur
 * `etat` qui ne décrit que l'instant présent. Un appelant qui l'oublierait afficherait
 * « tout est libre » avant de se faire refuser par le serveur — le rendre optionnel
 * laisserait le compilateur passer à côté.
 */
export type Unite = Pick<Appareil, "notion_id" | "ref_appareil" | "type" | "etat"> & {
  prets: Pret[];
};

export function NouvelExamenButton({
  patients,
  interpretes,
  unites,
  defaultPatient,
  label,
}: {
  patients: { notion_id: string; nom: string | null }[];
  interpretes: { notion_id: string; nom: string | null }[];
  unites: Unite[];
  defaultPatient?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { lang, tr } = useTr();
  const today = new Date().toISOString().slice(0, 10);
  const [pose, setPose] = useState(today);

  // Disponibilité jugée à la DATE demandée, pas sur l'état courant : c'est ce qui
  // permet de réserver un appareil encore dehors mais rendu d'ici là.
  const horsService = (u: Unite) => Boolean(u.etat) && !["Au cabinet", "Dehors"].includes(u.etat!);
  // `fin` = retour prévu demandé. Sans lui, la disponibilité ne peut être jugée que sur la
  // date de pose ; le serveur, qui l'exige, tranchera sur la plage complète.
  const freeOf = (t: string, date: string, fin: string | null) =>
    unites.filter((u) => u.type === t && !horsService(u) && uniteDisponible(u.prets, date, fin, today));
  const ofType = (t: string) => unites.filter((u) => u.type === t && !horsService(u));

  const initialType = TYPES_APPAREIL.find((t) => freeOf(t, today, null).length > 0) ?? TYPES_APPAREIL[0];
  const [type, setType] = useState<string>(initialType);
  const [patient, setPatient] = useState(defaultPatient ?? "");
  const [unite, setUnite] = useState(freeOf(initialType, today, null)[0]?.notion_id ?? "");
  const [indication, setIndication] = useState("");
  const [site, setSite] = useState<string>(SITES[0]);
  const [retour, setRetour] = useState("");
  const [interprete, setInterprete] = useState("");

  const libres = freeOf(type, pose, retour || null);
  // Les autres unités du type, avec la date à laquelle elles se libèrent : bien plus utile
  // qu'une liste vide quand tout est sorti (« Holter n°2 — libre à partir du 7 juin »).
  const occupees = ofType(type)
    .filter((u) => !libres.some((l) => l.notion_id === u.notion_id))
    .map((u) => ({ u, libre: prochaineDisponibilite(u.prets, pose, retour || null, today) }))
    .sort((a, b) => (a.libre ?? "9999").localeCompare(b.libre ?? "9999"));

  // Changer la date de pose peut invalider l'unité choisie : on la libère plutôt que
  // d'envoyer au serveur un choix qu'il refusera.
  const uniteEncoreValide = !unite || libres.some((u) => u.notion_id === unite);
  const uniteEffective = uniteEncoreValide ? unite : "";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!uniteEffective) {
      setError(tr.examens.unitRequired);
      return;
    }
    if (!retour) {
      setError(tr.examens.returnRequired);
      return;
    }
    run(
      () =>
        creerExamen({
          type,
          patient,
          appareil: uniteEffective,
          indication: indication || null,
          site,
          date_pose: pose,
          restitution_prevue: retour,
          interprete: interprete || null,
        }),
      () => {
        setOpen(false);
        setUnite(""); setRetour("");
      },
      tr.toast.examCreated
    );
  }

  return (
    <>
      <Button size="sm" onClick={() => { setError(null); setOpen(true); }}>
        <Plus className="size-3.5" /> {label ?? tr.examens.newExam}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={label ?? tr.examens.newExam} icon={<Watch />}>
        <form onSubmit={submit} className="space-y-3">
          <Field label={tr.common.patient}>
            <Select value={patient} onChange={(e) => setPatient(e.target.value)} required disabled={Boolean(defaultPatient)}>
              <option value="">{tr.common.choose}</option>
              {patients.map((p) => (
                <option key={p.notion_id} value={p.notion_id}>{p.nom}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr.common.type} hint={tr.examens.availabilityHint}>
              <Select value={type} onChange={(e) => { const t = e.target.value; setType(t); setUnite(freeOf(t, pose, retour || null)[0]?.notion_id ?? ""); }}>
                {TYPES_APPAREIL.map((t) => {
                  const n = freeOf(t, pose, retour || null).length;
                  return <option key={t} value={t}>{t} — {tr.examens.availableCount(n)}</option>;
                })}
              </Select>
            </Field>
            <Field label={tr.examens.unitLabel} hint={tr.examens.unitHint}>
              <Select value={uniteEffective} onChange={(e) => setUnite(e.target.value)} required>
                {/* Plus d'option « Sans appareil » : un examen immobilise toujours un boîtier.
                    Quand rien n'est libre à cette date, on ANNONCE la date de libération
                    plutôt que d'afficher une liste vide (décision réunion juil. 2026). */}
                <option value="" disabled>
                  {libres.length === 0 ? tr.examens.noFreeUnit : tr.common.choose}
                </option>
                {libres.map((u) => (
                  <option key={u.notion_id} value={u.notion_id}>{u.ref_appareil}</option>
                ))}
                {occupees.map(({ u, libre }) => (
                  <option key={u.notion_id} value={u.notion_id} disabled>
                    {/* formatDate : sans lui, l'ISO brut « 2026-06-07 » s'afficherait à l'écran */}
                    {u.ref_appareil} — {libre ? tr.examens.freeFrom(formatDate(libre, lang)) : tr.examens.freeUnknown}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tr.examens.colIndication}>
              <Select value={indication} onChange={(e) => setIndication(e.target.value)}>
                <option value="">{tr.common.empty}</option>
                {INDICATIONS_EXAMEN.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </Select>
            </Field>
            <Field label={tr.dialogs.site}>
              <Select value={site} onChange={(e) => setSite(e.target.value)}>
                {SITES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label={tr.examens.poseLabel}>
              <Input type="date" value={pose} onChange={(e) => setPose(e.target.value)} required />
            </Field>
            {/* Requis : sans retour prévu, la fin du prêt est inconnue et l'unité serait
                bloquée indéfiniment pour tous les suivants. */}
            <Field label={tr.examens.returnLabel} hint={tr.examens.returnHint}>
              <Input type="date" value={retour} min={pose} onChange={(e) => setRetour(e.target.value)} required />
            </Field>
            <Field label={tr.examens.colInterpreter}>
              <Select value={interprete} onChange={(e) => setInterprete(e.target.value)}>
                <option value="">{tr.common.empty}</option>
                {interpretes.map((m) => (
                  <option key={m.notion_id} value={m.notion_id}>{m.nom}</option>
                ))}
              </Select>
            </Field>
          </div>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{tr.common.cancel}</Button>
            <Button type="submit" loading={pending}>{tr.examens.createExam}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function NouvelAppareilButton() {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { tr } = useTr();
  const [type, setType] = useState<string>(TYPES_APPAREIL[0]);
  const [numero, setNumero] = useState("");
  const [dateAchat, setDateAchat] = useState("");
  const [notes, setNotes] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () => creerAppareil({ type, numero: numero || null, date_achat: dateAchat || null, notes: notes || null }),
      () => {
        setOpen(false);
        setNumero(""); setDateAchat(""); setNotes("");
      },
      tr.toast.deviceAdded
    );
  }

  const previewRef = numero.trim() ? `${type} n°${numero.trim()}` : type;

  return (
    <>
      <Button size="sm" onClick={() => { setError(null); setOpen(true); }}>
        <Plus className="size-3.5" /> {tr.appareils.newDevice}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tr.appareils.newDevice} icon={<Watch />}>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr.common.type}>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES_APPAREIL.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label={tr.appareils.deviceNumber} hint={tr.appareils.deviceNumberHint}>
              <Input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="6" />
            </Field>
            <Field label={tr.appareils.purchaseDate}>
              <Input type="date" value={dateAchat} onChange={(e) => setDateAchat(e.target.value)} />
            </Field>
            <Field label={tr.appareils.deviceNotes}>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tr.appareils.serialPlaceholder} />
            </Field>
          </div>
          <p className="text-xs text-muted">{tr.appareils.refPreview} <span className="font-medium text-foreground">{previewRef}</span></p>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{tr.common.cancel}</Button>
            <Button type="submit" loading={pending}>{tr.appareils.createDevice}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function EtatAppareilSelect({ appareilId, value }: { appareilId: string; value: string | null }) {
  const { pending, error, run } = useAction();
  const { lang, tr } = useTr();
  return (
    <div>
      <Select
        className="h-7 w-auto text-xs"
        value={value ?? ""}
        disabled={pending || value === "Dehors"}
        onChange={(e) => e.target.value && run(() => setEtatAppareil(appareilId, e.target.value), undefined, tr.toast.saved)}
      >
        {value === "Dehors" && <option value="Dehors">{tv(lang, "Dehors")}</option>}
        {Object.keys(ETAT_APPAREIL_UNITE)
          .filter((s) => s !== "Dehors")
          .map((s) => (
            <option key={s} value={s}>{tv(lang, s)}</option>
          ))}
      </Select>
      <ErrorText error={error} />
    </div>
  );
}

export function CATSelect({ examenId, value }: { examenId: string; value: string | null }) {
  const { pending, error, run } = useAction();
  const { lang, tr } = useTr();
  return (
    <div>
      <Select
        className="h-7 w-auto text-xs"
        value={value ?? ""}
        disabled={pending}
        onChange={(e) => e.target.value && run(() => setCAT(examenId, e.target.value), undefined, tr.toast.saved)}
      >
        {!value && <option value="">{tr.common.empty}</option>}
        {Object.keys(CAT_EXAMEN).map((s) => (
          <option key={s} value={s}>{tv(lang, s)}</option>
        ))}
      </Select>
      <ErrorText error={error} />
    </div>
  );
}

/** Modale d'interprétation d'un examen rendu : résultats + CAT (si polygraphie). */
export function InterpreterButton({
  examen,
  edit,
}: {
  examen: Pick<Examen, "notion_id" | "type" | "resultats" | "conclusion" | "cat" | "date_interpretation">;
  edit?: boolean; // affichage « modifier » pour un examen déjà interprété
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { lang, tr } = useTr();
  const [resultats, setResultats] = useState(examen.resultats ?? "");
  const [conclusion, setConclusion] = useState(examen.conclusion ?? "");
  const [cat, setCat] = useState(examen.cat ?? "");
  const isPPG = examen.type === "Polygraphie";
  const already = Boolean(examen.date_interpretation);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () => interpreterExamen(examen.notion_id, { resultats: resultats || null, conclusion: conclusion || null, cat: cat || null }),
      () => setOpen(false),
      tr.toast.examInterpreted
    );
  }

  return (
    <>
      {edit ? (
        <button
          onClick={() => { setError(null); setOpen(true); }}
          title={tr.examens.editInterpretation}
          aria-label={tr.examens.editInterpretation}
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-foreground"
        >
          <Pencil className="size-4" />
        </button>
      ) : (
        <Button size="sm" onClick={() => { setError(null); setOpen(true); }}>
          <Microscope className="size-3.5" /> {tr.examens.interpret}
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={tr.examens.interpret} icon={<Microscope />}>
        <form onSubmit={submit} className="space-y-3">
          <Field label={tr.examens.resultsLabel} hint={tr.examens.resultsHint}>
            <textarea
              value={resultats}
              onChange={(e) => setResultats(e.target.value)}
              placeholder={tr.examens.resultsPlaceholder}
              autoFocus
              rows={4}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted hover:border-ring/70 focus:outline-2 focus:outline-ring"
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr.examens.conclusionLabel}>
              <Select value={conclusion} onChange={(e) => setConclusion(e.target.value)}>
                <option value="">{tr.common.empty}</option>
                {Object.keys(CONCLUSION_EXAMEN).map((s) => (
                  <option key={s} value={s}>{tv(lang, s)}</option>
                ))}
              </Select>
            </Field>
            {isPPG && (
              <Field label={tr.examens.followUpLabel}>
                <Select value={cat} onChange={(e) => setCat(e.target.value)}>
                  <option value="">{tr.common.empty}</option>
                  {Object.keys(CAT_EXAMEN).map((s) => (
                    <option key={s} value={s}>{tv(lang, s)}</option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          <p className="text-xs text-muted">{tr.examens.interpretHint}</p>
          <ErrorText error={error} />
          <div className="flex items-center justify-between gap-2 pt-1">
            {already ? (
              <Button type="button" variant="ghost" loading={pending} onClick={() => run(() => interpreterExamen(examen.notion_id, { clear: true }), () => setOpen(false), tr.toast.saved)}>
                <Trash2 className="size-3.5" /> {tr.examens.clearInterpretation}
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{tr.common.cancel}</Button>
              <Button type="submit" loading={pending}>{tr.examens.markInterpreted}</Button>
            </div>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Marquer le compte rendu envoyé. */
export function EnvoyerExamenButton({ examenId }: { examenId: string }) {
  const { pending, error, run } = useAction();
  const { tr } = useTr();
  return (
    <div>
      <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => envoyerExamen(examenId), undefined, tr.toast.reportSent)}>
        <Send className="size-3.5" /> {tr.examens.markSent}
      </Button>
      <ErrorText error={error} />
    </div>
  );
}

export function AppareillageButton({ examen }: { examen: Pick<Examen, "notion_id" | "contacte_appareillage" | "societe_appareillage" | "appareillage_pose_le" | "rdv_suivi_pgv" | "rdv_pneumologue"> }) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { tr } = useTr();
  const d = (v: string | null) => (v ? v.slice(0, 10) : "");
  const [contacte, setContacte] = useState(examen.contacte_appareillage);
  const [societe, setSociete] = useState(examen.societe_appareillage ?? "");
  const [poseLe, setPoseLe] = useState(d(examen.appareillage_pose_le));
  const [rdvPgv, setRdvPgv] = useState(d(examen.rdv_suivi_pgv));
  const [rdvPneumo, setRdvPneumo] = useState(d(examen.rdv_pneumologue));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        majAppareillage(examen.notion_id, {
          contacte,
          societe: societe || null,
          pose_le: poseLe || null,
          rdv_pgv: rdvPgv || null,
          rdv_pneumo: rdvPneumo || null,
        }),
      () => setOpen(false),
      tr.toast.saved
    );
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setError(null); setOpen(true); }}>
        <Stethoscope className="size-3.5" /> {tr.examens.aftercareEdit}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tr.examens.aftercareEdit} icon={<Stethoscope />}>
        <form onSubmit={submit} className="space-y-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={contacte} onChange={(e) => setContacte(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
            {tr.examens.contactedLabel}
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr.examens.companyLabel}>
              <Select value={societe} onChange={(e) => setSociete(e.target.value)}>
                <option value="">{tr.common.empty}</option>
                {SOCIETES_APPAREILLAGE.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label={tr.examens.fittedLabel}>
              <Input type="date" value={poseLe} onChange={(e) => setPoseLe(e.target.value)} />
            </Field>
            <Field label={tr.examens.rdvPgvLabel}>
              <Input type="date" value={rdvPgv} onChange={(e) => setRdvPgv(e.target.value)} />
            </Field>
            <Field label={tr.examens.rdvPneumoLabel}>
              <Input type="date" value={rdvPneumo} onChange={(e) => setRdvPneumo(e.target.value)} />
            </Field>
          </div>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{tr.common.cancel}</Button>
            <Button type="submit" loading={pending}>{tr.common.save}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function FacturerPenaliteButton({ examenId, days, amount }: { examenId: string; days: number; amount: string }) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { tr } = useTr();
  return (
    <>
      <Button size="sm" variant="danger" onClick={() => { setError(null); setOpen(true); }}>
        <Euro className="size-3.5" /> {tr.examens.billPenalty}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tr.examens.billPenalty} icon={<Euro />}>
        <div className="space-y-4">
          <p className="text-sm font-medium">{tr.examens.penaltyDays(days, amount)}</p>
          <p className="text-xs text-muted">{tr.examens.billPenaltyConfirm}</p>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>{tr.common.cancel}</Button>
            <Button variant="danger" loading={pending} onClick={() => run(() => facturerPenalite(examenId), () => setOpen(false), tr.toast.penaltyBilled)}>
              {tr.examens.billPenalty}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/* ---------- Perfusions ---------- */

export function NouvellePerfusionButton({
  patients,
  praticiens = [],
}: {
  patients: { notion_id: string; nom: string | null }[];
  /** Qui peut faire la séance. Sans praticien, aucune part n'est calculable. */
  praticiens?: { notion_id: string; nom: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { lang, tr } = useTr();
  const today = new Date().toISOString().slice(0, 10);
  const [patient, setPatient] = useState("");
  const [date, setDate] = useState(today);
  const [composants, setComposants] = useState("");
  const [duree, setDuree] = useState("");
  const [bio, setBio] = useState("");
  const [hono, setHono] = useState("");
  const [forfait, setForfait] = useState("");
  const [praticien, setPraticien] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        creerPerfusion({
          patient,
          date_perfusion: date,
          composants: composants || null,
          duree: duree || null,
          bilan_bio: bio || null,
          honoraire_ipa: hono ? Number(hono) : null,
          forfait: forfait ? Number(forfait) : null,
          praticien: praticien || null,
        }),
      () => {
        setOpen(false);
        setComposants(""); setDuree(""); setHono(""); setForfait(""); setPraticien("");
      },
      tr.toast.perfusionCreated
    );
  }

  return (
    <>
      <Button size="sm" onClick={() => { setError(null); setOpen(true); }}>
        <Plus className="size-3.5" /> {tr.perfusions.newSession}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tr.perfusions.newSession} icon={<Syringe />}>
        <form onSubmit={submit} className="space-y-3">
          <Field label={tr.common.patient}>
            <Select value={patient} onChange={(e) => setPatient(e.target.value)} required>
              <option value="">{tr.common.choose}</option>
              {patients.map((p) => (
                <option key={p.notion_id} value={p.notion_id}>{p.nom}</option>
              ))}
            </Select>
          </Field>
          {praticiens.length > 0 && (
            <Field label={tr.perfusions.practitioner} hint={tr.perfusions.practitionerHint}>
              <Select value={praticien} onChange={(e) => setPraticien(e.target.value)}>
                <option value="">{tr.common.choose}</option>
                {praticiens.map((p) => (
                  <option key={p.notion_id} value={p.notion_id}>{p.nom}</option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr.perfusions.dateLabel}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label={tr.perfusions.durationLabel}>
              <Input value={duree} onChange={(e) => setDuree(e.target.value)} placeholder={tr.perfusions.durationPlaceholder} />
            </Field>
            <Field label={tr.perfusions.bioLabel}>
              <Select value={bio} onChange={(e) => setBio(e.target.value)}>
                <option value="">{tr.common.empty}</option>
                {["Oui", "Non"].map((b) => (
                  <option key={b} value={b}>{tv(lang, b)}</option>
                ))}
              </Select>
            </Field>
            <Field label={tr.perfusions.feeLabel}>
              <Input type="number" step="1" min="0" value={hono} onChange={(e) => setHono(e.target.value)} placeholder="150" />
            </Field>
            <Field label={tr.perfusions.forfaitLabel} hint={tr.perfusions.forfaitHint}>
              <Input type="number" step="1" min="0" value={forfait} onChange={(e) => setForfait(e.target.value)} placeholder="350" />
            </Field>
          </div>
          <Field label={tr.perfusions.componentsLabel}>
            <Input value={composants} onChange={(e) => setComposants(e.target.value)} placeholder={tr.perfusions.componentsPlaceholder} />
          </Field>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{tr.common.cancel}</Button>
            <Button type="submit" loading={pending}>{tr.perfusions.createSession}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Édition d'une séance de perfusion enregistrée (le patient reste fixe). */
export function ModifierPerfusionButton({
  perfusion,
  praticiens = [],
}: {
  perfusion: Pick<
    Perfusion,
    "notion_id" | "date_perfusion" | "composants" | "duree" | "bilan_bio" | "honoraire_ipa" | "notes" | "praticien"
  >;
  praticiens?: { notion_id: string; nom: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { lang, tr } = useTr();
  const [date, setDate] = useState(perfusion.date_perfusion?.slice(0, 10) ?? "");
  const [composants, setComposants] = useState(perfusion.composants ?? "");
  const [duree, setDuree] = useState(perfusion.duree ?? "");
  const [bio, setBio] = useState(perfusion.bilan_bio ?? "");
  const [hono, setHono] = useState(perfusion.honoraire_ipa != null ? String(perfusion.honoraire_ipa) : "");
  const [notes, setNotes] = useState(perfusion.notes ?? "");
  const [praticien, setPraticien] = useState(perfusion.praticien?.[0] ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        majPerfusion(perfusion.notion_id, {
          date_perfusion: date || null,
          composants: composants || null,
          duree: duree || null,
          bilan_bio: bio || null,
          honoraire_ipa: hono ? Number(hono) : null,
          notes: notes || null,
          praticien: praticien || null,
        }),
      () => setOpen(false),
      tr.toast.saved
    );
  }

  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true); }}
        title={tr.common.edit}
        aria-label={tr.common.edit}
        className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-foreground"
      >
        <Pencil className="size-4" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tr.perfusions.editSession} icon={<Pencil />}>
        <form onSubmit={submit} className="space-y-3">
          {praticiens.length > 0 && (
            <Field label={tr.perfusions.practitioner} hint={tr.perfusions.practitionerHint}>
              <Select value={praticien} onChange={(e) => setPraticien(e.target.value)}>
                <option value="">{tr.common.choose}</option>
                {praticiens.map((p) => (
                  <option key={p.notion_id} value={p.notion_id}>{p.nom}</option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr.perfusions.dateLabel}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label={tr.perfusions.durationLabel}>
              <Input value={duree} onChange={(e) => setDuree(e.target.value)} placeholder={tr.perfusions.durationPlaceholder} />
            </Field>
            <Field label={tr.perfusions.bioLabel}>
              <Select value={bio} onChange={(e) => setBio(e.target.value)}>
                <option value="">{tr.common.empty}</option>
                {["Oui", "Non"].map((b) => (
                  <option key={b} value={b}>{tv(lang, b)}</option>
                ))}
              </Select>
            </Field>
            <Field label={tr.perfusions.feeLabel}>
              <Input type="number" step="1" min="0" value={hono} onChange={(e) => setHono(e.target.value)} placeholder="150" />
            </Field>
          </div>
          <Field label={tr.perfusions.componentsLabel}>
            <Input value={composants} onChange={(e) => setComposants(e.target.value)} placeholder={tr.perfusions.componentsPlaceholder} />
          </Field>
          <Field label={tr.dialogs.secretaryNotes}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{tr.common.cancel}</Button>
            <Button type="submit" loading={pending}>{tr.common.save}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/* ---------- Patients : édition fiche ---------- */

export function ModifierPatientButton({
  patient,
}: {
  patient: { notion_id: string; prenom: string | null; nom_famille: string | null; date_naissance: string | null; telephone: string | null; email: string | null; adresse: string | null; notes_secretariat: string | null };
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { tr } = useTr();
  const [prenom, setPrenom] = useState(patient.prenom ?? "");
  const [nom, setNom] = useState(patient.nom_famille ?? "");
  const [naissance, setNaissance] = useState(patient.date_naissance?.slice(0, 10) ?? "");
  const [telephone, setTelephone] = useState(patient.telephone ?? "");
  const [email, setEmail] = useState(patient.email ?? "");
  const [adresse, setAdresse] = useState(patient.adresse ?? "");
  const [notes, setNotes] = useState(patient.notes_secretariat ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        majPatientInfos(patient.notion_id, {
          prenom: prenom || null,
          nom: nom || null,
          date_naissance: naissance || null,
          telephone: telephone || null,
          email: email || null,
          adresse: adresse || null,
          notes_secretariat: notes || null,
        }),
      () => setOpen(false),
      tr.toast.saved
    );
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setError(null); setOpen(true); }}>
        <Pencil className="size-3.5" /> {tr.dialogs.editPatient}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tr.dialogs.editPatient} icon={<Pencil />}>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr.dialogs.firstName}>
              <Input value={prenom} onChange={(e) => setPrenom(e.target.value)} placeholder={tr.dialogs.firstNamePlaceholder} />
            </Field>
            <Field label={tr.dialogs.lastName}>
              <Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder={tr.dialogs.lastNamePlaceholder} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr.dialogs.birthDate}>
              <Input type="date" value={naissance} onChange={(e) => setNaissance(e.target.value)} />
            </Field>
            <Field label={tr.dialogs.phone}>
              <Input value={telephone} onChange={(e) => setTelephone(e.target.value)} placeholder="+33…" />
            </Field>
            <Field label={tr.dialogs.email}>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label={tr.dialogs.address}>
              <Input value={adresse} onChange={(e) => setAdresse(e.target.value)} />
            </Field>
          </div>
          <Field label={tr.dialogs.secretaryNotes}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tr.dialogs.secretaryNotesPlaceholder} />
          </Field>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{tr.common.cancel}</Button>
            <Button type="submit" loading={pending}>{tr.common.save}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/* ---------- Inventaire (consommables) ---------- */

export function NouvelArticleButton() {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { lang, tr } = useTr();
  const [article, setArticle] = useState("");
  const [categorie, setCategorie] = useState<string>(CATEGORIES_STOCK[0]);
  const [quantite, setQuantite] = useState("");
  const [unite, setUnite] = useState<string>(UNITES_STOCK[0]);
  const [seuil, setSeuil] = useState("");
  const [fournisseur, setFournisseur] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        creerArticle({
          article,
          categorie,
          quantite: quantite ? Number(quantite) : 0,
          unite,
          seuil_minimum: seuil ? Number(seuil) : 0,
          fournisseur: fournisseur || null,
        }),
      () => {
        setOpen(false);
        setArticle(""); setQuantite(""); setSeuil(""); setFournisseur("");
      },
      tr.toast.articleCreated
    );
  }

  return (
    <>
      <Button size="sm" onClick={() => { setError(null); setOpen(true); }}>
        <Plus className="size-3.5" /> {tr.inventaire.newArticle}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tr.inventaire.newArticle} icon={<Package />}>
        <form onSubmit={submit} className="space-y-3">
          <Field label={tr.inventaire.articleName}>
            <Input value={article} onChange={(e) => setArticle(e.target.value)} required autoFocus placeholder={tr.inventaire.articlePlaceholder} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr.inventaire.colCategory}>
              <Select value={categorie} onChange={(e) => setCategorie(e.target.value)}>
                {CATEGORIES_STOCK.map((c) => (
                  <option key={c} value={c}>{tv(lang, c)}</option>
                ))}
              </Select>
            </Field>
            <Field label={tr.inventaire.colUnit}>
              <Select value={unite} onChange={(e) => setUnite(e.target.value)}>
                {UNITES_STOCK.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
            </Field>
            <Field label={tr.inventaire.initialQty}>
              <Input type="number" min="0" step="1" value={quantite} onChange={(e) => setQuantite(e.target.value)} placeholder="0" />
            </Field>
            <Field label={tr.inventaire.thresholdLabel} hint={tr.inventaire.thresholdHint}>
              <Input type="number" min="0" step="1" value={seuil} onChange={(e) => setSeuil(e.target.value)} placeholder="0" />
            </Field>
          </div>
          <Field label={tr.inventaire.supplierLabel}>
            <Input value={fournisseur} onChange={(e) => setFournisseur(e.target.value)} placeholder="Ex. Air+, Medline…" />
          </Field>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{tr.common.cancel}</Button>
            <Button type="submit" loading={pending}>{tr.inventaire.createArticle}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Entrée (réappro) ou Sortie (utilisation) : écrit le journal + la quantité. */
export function MouvementStockButton({
  article,
  sens,
  personnel,
  defaultPar,
}: {
  article: Pick<Article, "notion_id" | "article" | "quantite">;
  sens: "Entrée" | "Sortie";
  personnel?: { notion_id: string; nom: string | null }[];
  defaultPar?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { tr } = useTr();
  const [qte, setQte] = useState("");
  const [motif, setMotif] = useState("");
  const [par, setPar] = useState(defaultPar ?? "");
  const [confirming, setConfirming] = useState(false);
  const isIn = sens === "Entrée";
  const current = Number(article.quantite ?? 0);
  const q = Number(qte || 0);
  const next = isIn ? current + q : current - q;
  const parName = personnel?.find((p) => p.notion_id === par)?.nom ?? null;

  function reset() {
    setOpen(false);
    setQte(""); setMotif(""); setConfirming(false);
    setPar(defaultPar ?? "");
  }

  // Étape 1 → demande de confirmation ; étape 2 → écriture réelle.
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirming) { setConfirming(true); return; }
    run(
      () => mouvementStock(article.notion_id, { sens, quantite: q, motif: motif || null, par: par || null }),
      reset,
      tr.toast.stockMoved
    );
  }

  return (
    <>
      <Button size="sm" variant={isIn ? "secondary" : "ghost"} onClick={() => { setError(null); setOpen(true); }}>
        {isIn ? <ArrowDownToLine className="size-3.5" /> : <ArrowUpFromLine className="size-3.5" />}
        {isIn ? tr.inventaire.restock : tr.inventaire.usage}
      </Button>
      <Dialog
        open={open}
        onClose={reset}
        title={`${isIn ? tr.inventaire.restockTitle : tr.inventaire.usageTitle} — ${article.article}`}
        icon={isIn ? <ArrowDownToLine /> : <ArrowUpFromLine />}
      >
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr.inventaire.qtyLabel}>
              <Input type="number" min="1" step="1" value={qte} onChange={(e) => setQte(e.target.value)} required autoFocus disabled={confirming} />
            </Field>
            <Field label={tr.inventaire.reasonLabel}>
              <Input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder={tr.inventaire.reasonPlaceholder} disabled={confirming} />
            </Field>
          </div>
          {personnel && (
            <Field label={tr.inventaire.doneBy}>
              <Select value={par} onChange={(e) => setPar(e.target.value)} disabled={confirming}>
                <option value="">{tr.common.notAssigned}</option>
                {personnel.map((p) => (
                  <option key={p.notion_id} value={p.notion_id}>{p.nom}</option>
                ))}
              </Select>
            </Field>
          )}
          <p className={`text-xs ${next < 0 ? "font-medium text-danger" : "text-muted"}`}>
            {next < 0 ? tr.inventaire.notEnough : tr.inventaire.afterMove(next)}
          </p>
          <ErrorText error={error} />
          {confirming ? (
            <div className="rounded-lg border border-border bg-surface/60 p-3 text-sm">
              <p className="font-medium">
                {tr.inventaire.confirmMove(isIn ? tr.inventaire.restock : tr.inventaire.usage, q, article.article ?? "", parName)}
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>{tr.common.no}</Button>
                <Button type="submit" loading={pending}>{tr.common.yes}</Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={reset}>{tr.common.cancel}</Button>
              <Button type="submit" disabled={!q || next < 0}>{tr.common.continue}</Button>
            </div>
          )}
        </form>
      </Dialog>
    </>
  );
}

/** Seuil minimum inline : input + bouton Enregistrer quand modifié. */
export function SeuilArticle({ articleId, seuil }: { articleId: string; seuil: number | null }) {
  const { pending, error, run } = useAction();
  const { tr } = useTr();
  const [v, setV] = useState(String(seuil ?? 0));
  const dirty = v !== String(seuil ?? 0);
  return (
    <div className="flex items-center gap-1.5">
      <Input className="h-7 w-16 text-xs tabular-nums" type="number" min="0" step="1" value={v} onChange={(e) => setV(e.target.value)} />
      {dirty && (
        <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => setSeuilArticle(articleId, Number(v || 0)), undefined, tr.toast.thresholdSaved)}>
          <Check className="size-3.5" />
        </Button>
      )}
      <ErrorText error={error} />
    </div>
  );
}

/** Historique des mouvements d'un article (journal auditable). */
export function HistoriqueArticleButton({
  article,
  mouvements,
  personnel,
}: {
  article: Pick<Article, "notion_id" | "article" | "unite">;
  mouvements: Mouvement[];
  personnel: { notion_id: string; nom: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const { lang, tr } = useTr();
  const nomDe = (ids: string[]) => {
    const id = ids?.[0];
    return id ? personnel.find((p) => p.notion_id === id)?.nom ?? "?" : "·";
  };
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={tr.inventaire.historyTitle}
        aria-label={tr.inventaire.historyTitle}
        className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground"
      >
        <History className="size-4" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`${tr.inventaire.historyTitle} — ${article.article}`} icon={<History />}>
        <p className="mb-3 text-xs text-muted">{tr.inventaire.historySub}</p>
        {mouvements.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">{tr.inventaire.historyEmpty}</p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {mouvements.map((m) => (
              <li key={m.notion_id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm">
                <span className={`font-semibold tabular-nums ${m.sens === "Entrée" ? "text-success" : "text-danger"}`}>
                  {m.sens === "Entrée" ? "+" : "−"}{m.quantite ?? 0}{article.unite ? ` ${article.unite}` : ""}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{m.motif || tv(lang, m.sens ?? "") || ""}</span>
                <span className="whitespace-nowrap text-xs text-muted">{nomDe(m.par)} · {m.date_mouvement ? new Date(m.date_mouvement).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB") : "·"}</span>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </>
  );
}

/* ---------- Paramètres (admin) ---------- */

/**
 * Éditeur de paramètre à contrôle typé : le type est déduit de la valeur —
 * on/off → interrupteur, nombre → compteur (−/+), sinon → texte. Aucune
 * migration : Notion et l'app restent identiques automatiquement.
 */
export function ParametreValeur({ parametreId, valeur }: { parametreId: string; valeur: string | null }) {
  const { pending, error, run } = useAction();
  const { tr } = useTr();
  const initial = (valeur ?? "").trim();
  const isToggle = /^(on|off)$/i.test(initial);
  const isNumber = !isToggle && /^-?\d+([.,]\d+)?$/.test(initial);
  const [v, setV] = useState(initial);
  const dirty = v !== initial;
  const save = (val: string) => run(() => setParametre(parametreId, val), undefined, tr.toast.saved);

  if (isToggle) {
    const on = v.toLowerCase() === "on";
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={pending}
          onClick={() => { const next = on ? "off" : "on"; setV(next); save(next); }}
          className={cn(
            "relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50",
            on ? "bg-success" : "bg-border"
          )}
        >
          <span className={cn("inline-block size-4 transform rounded-full bg-white shadow transition-transform", on ? "translate-x-4" : "translate-x-0.5")} />
        </button>
        <span className="text-xs text-muted">{on ? tr.common.yes : tr.common.no}</span>
        <ErrorText error={error} />
      </div>
    );
  }

  if (isNumber) {
    const num = Number(v.replace(",", ".")) || 0;
    const setNum = (n: number) => setV(String(Math.max(0, n)));
    return (
      <div className="flex items-center gap-1.5">
        <button type="button" disabled={pending} onClick={() => setNum(num - 1)} className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-surface text-muted hover:text-foreground disabled:opacity-50" aria-label="−">
          <Minus className="size-3.5" />
        </button>
        <Input className="h-7 w-16 text-center text-xs tabular-nums" type="number" min="0" value={v} onChange={(e) => setV(e.target.value)} />
        <button type="button" disabled={pending} onClick={() => setNum(num + 1)} className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-surface text-muted hover:text-foreground disabled:opacity-50" aria-label="+">
          <Plus className="size-3.5" />
        </button>
        {dirty && (
          <Button size="sm" variant="secondary" loading={pending} onClick={() => save(v)}>
            <Check className="size-3.5" />
          </Button>
        )}
        <ErrorText error={error} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input className="h-7 w-48 text-xs" value={v} onChange={(e) => setV(e.target.value)} />
      {dirty && (
        <Button size="sm" variant="secondary" loading={pending} onClick={() => save(v)}>
          <Check className="size-3.5" /> {tr.common.save}
        </Button>
      )}
      <ErrorText error={error} />
    </div>
  );
}
