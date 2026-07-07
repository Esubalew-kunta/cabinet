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
import { MODES_PAIEMENT } from "@/lib/labels";
import { RECURRENCE, tv } from "@/lib/i18n/dict";
import { useTr } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import { Check, CheckCheck, CreditCard, Hand, Plus, Trash2, UserPlus } from "lucide-react";
import {
  verifierDossier,
  setStatutIntake,
  setStatutMedecin,
  setStatutTache,
  reassignerTache,
  prendreTache,
  supprimerTache,
  creerTache,
  creerPatient,
  enregistrerPaiement,
  creerPaiement,
  appareilRendu,
  assignerMedecin,
} from "@/lib/actions";

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

export function VerifierDossierButton({ dossierId }: { dossierId: string }) {
  const { pending, error, run } = useAction();
  const { tr } = useTr();
  return (
    <div>
      <Button
        size="sm"
        variant="success"
        loading={pending}
        onClick={() => run(() => verifierDossier(dossierId), undefined, tr.toast.dossierVerified)}
      >
        <CheckCheck className="size-3.5" /> {tr.dialogs.verify}
      </Button>
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
}: {
  personnel: { notion_id: string; nom: string | null }[];
  patients?: { notion_id: string; nom: string | null }[];
  defaultPatient?: string;
  defaultDossier?: string;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { lang, tr } = useTr();
  const [titre, setTitre] = useState("");
  const [echeance, setEcheance] = useState("");
  const [priorite, setPriorite] = useState("Normale");
  const [domaine, setDomaine] = useState("Clinique");
  const [calendrier, setCalendrier] = useState("Ponctuelle");
  const [recurrence, setRecurrence] = useState("weekly");
  const [responsable, setResponsable] = useState("");
  const [patient, setPatient] = useState(defaultPatient ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        creerTache({
          titre,
          echeance: echeance || null,
          priorite,
          domaine,
          calendrier,
          recurrence: calendrier === "Récurrente" ? recurrence : null,
          responsable: responsable || null,
          patient: patient || null,
          dossier: defaultDossier || null,
        }),
      () => {
        setOpen(false);
        setTitre("");
        setEcheance("");
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
            <Field label={tr.dialogs.domain}>
              <Select value={domaine} onChange={(e) => setDomaine(e.target.value)}>
                {["Clinique", "Professionnel", "Personnel", "Projets"].map((d) => (
                  <option key={d} value={d}>{tv(lang, d)}</option>
                ))}
              </Select>
            </Field>
            <Field label={tr.common.type}>
              <Select value={calendrier} onChange={(e) => setCalendrier(e.target.value)}>
                {["Ponctuelle", "Récurrente"].map((c) => (
                  <option key={c} value={c}>{tv(lang, c)}</option>
                ))}
              </Select>
            </Field>
            {calendrier === "Récurrente" && (
              <Field label={tr.dialogs.recurrence}>
                <Select value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
                  {Object.entries(RECURRENCE[lang]).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={tr.dialogs.ownerField} hint={tr.dialogs.ownerHint}>
              <Select value={responsable} onChange={(e) => setResponsable(e.target.value)}>
                <option value="">{tr.dialogs.ownerDefault}</option>
                {personnel.map((p) => (
                  <option key={p.notion_id} value={p.notion_id}>
                    {p.nom}
                  </option>
                ))}
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
      toast(tr.toast.taskDone, "success", {
        label: tr.common.undo,
        onAction: async () => {
          await setStatutTache(tacheId, statut ?? "À faire");
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

/* ---------- Patients ---------- */

export function NouveauPatientButton({
  medecins,
  problemes,
}: {
  medecins: { notion_id: string; nom: string | null }[];
  problemes: string[];
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, setError } = useAction();
  const { tr } = useTr();
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [email, setEmail] = useState("");
  const [probleme, setProbleme] = useState("");
  const [medecin, setMedecin] = useState("");
  const [doctolib, setDoctolib] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        creerPatient({
          nom,
          telephone: telephone || null,
          email: email || null,
          probleme_principal: probleme || null,
          medecin: medecin || null,
          lien_doctolib: doctolib || null,
        }),
      () => {
        setOpen(false);
        setNom(""); setTelephone(""); setEmail(""); setDoctolib("");
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
          <Field label={tr.dialogs.name}>
            <Input value={nom} onChange={(e) => setNom(e.target.value)} required autoFocus placeholder={tr.dialogs.namePlaceholder} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
  return (
    <div>
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        onClick={() => run(() => appareilRendu(examenId), undefined, tr.toast.deviceReturned)}
      >
        {tr.dialogs.markReturned}
      </Button>
      <ErrorText error={error} />
    </div>
  );
}
