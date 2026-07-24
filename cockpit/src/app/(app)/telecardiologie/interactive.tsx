"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HeartPulse, Plus, Pencil, Trash2, Check, X, Minus, Search, Download, Filter } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Field } from "@/components/ui/input";
import { useToast } from "@/components/toast";
import { useTr } from "@/components/i18n-provider";
import { cn, formatDate, EMPTY } from "@/lib/utils";
import { cellKey, formatMonth, currentMonthISO } from "@/lib/telecardio";
import {
  setStatutTelecardio,
  ajouterPatientTelecardio,
  modifierPatientTelecardio,
  retirerPatientTelecardio,
} from "@/lib/actions";
import type { TelecardioPatient } from "@/lib/types";
import type { Lang } from "@/lib/i18n/dict";

type Result = { ok: true } | { ok: false; error: string };
type TriState = boolean | null;

/** Le prochain état d'une case : vide → Oui → Non → vide. */
function nextState(v: TriState): TriState {
  if (v === null) return true;
  if (v === true) return false;
  return null;
}

export function TelecardioBoard({
  lang,
  patients,
  months,
  initialCells,
}: {
  lang: Lang;
  patients: TelecardioPatient[];
  months: string[];
  initialCells: Record<string, boolean>;
}) {
  const { tr } = useTr();
  const dict = tr.telecardiologie;
  const toast = useToast();
  const [, startTransition] = useTransition();

  // État local des cases (optimiste) : clé `${patientId}|${mois}` → tri-état.
  const [cells, setCells] = useState<Record<string, TriState>>(initialCells);
  const [pendingCells, setPendingCells] = useState<Set<string>>(new Set());

  // Recherche + filtres (tout côté client sur les données déjà chargées → instantané).
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | "prothese" | "holter">("all");
  const [onlyUnbilled, setOnlyUnbilled] = useState(false);

  const currentMonth = currentMonthISO();

  const patientName = (p: TelecardioPatient) => [p.nom, p.prenom].filter(Boolean).join(" ");

  // Compteurs par mois sur TOUS les patients (le total, pas la vue filtrée).
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const m of months) {
      let oui = 0;
      for (const p of patients) if (cells[cellKey(p.id, m)] === true) oui++;
      out.set(m, oui);
    }
    return out;
  }, [months, patients, cells]);

  // La vue : recherche + catégorie + « à facturer ce mois » (pas encore Oui ce mois-ci).
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return patients.filter((p) => {
      if (category !== "all" && p.categorie !== category) return false;
      if (q && !patientName(p).toLowerCase().includes(q)) return false;
      if (onlyUnbilled && cells[cellKey(p.id, currentMonth)] === true) return false;
      return true;
    });
  }, [patients, category, search, onlyUnbilled, cells, currentMonth]);

  function toggle(p: TelecardioPatient, mois: string) {
    const key = cellKey(p.id, mois);
    const prev: TriState = cells[key] ?? null;
    const next = nextState(prev);
    // Garde-fou : quitter l'état « facturé » (vert) est l'action conséquente et rare.
    if (prev === true && !window.confirm(dict.confirmUnbill)) return;

    setCells((c) => ({ ...c, [key]: next }));
    setPendingCells((s) => new Set(s).add(key));
    startTransition(async () => {
      const res = await setStatutTelecardio(p.id, mois, next, patientName(p));
      setPendingCells((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
      if (!res.ok) {
        setCells((c) => ({ ...c, [key]: prev })); // revert
        toast(res.error);
      }
    });
  }

  function exportCsv() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const head = [dict.fieldNom, dict.fieldPrenom, dict.fieldType, dict.fieldCategorie, ...months.map((m) => formatMonth(m, lang))];
    const lines = [head.map(esc).join(",")];
    for (const p of visible) {
      const row = [
        p.nom ?? "",
        p.prenom ?? "",
        p.type_appareil ?? "",
        p.categorie === "holter" ? dict.catHolter : dict.catProthese,
        ...months.map((m) => {
          const v = cells[cellKey(p.id, m)];
          return v === true ? dict.yes : v === false ? dict.no : "";
        }),
      ];
      lines.push(row.map((c) => esc(String(c))).join(","));
    }
    // BOM pour qu'Excel lise correctement les accents.
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `telecardiologie-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasFilter = search.trim() !== "" || category !== "all" || onlyUnbilled;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<HeartPulse />}
        title={dict.title}
        subtitle={dict.subtitle}
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} disabled={visible.length === 0}>
              <Download className="size-4" /> {dict.export}
            </Button>
            <PatientDialog mode="add" trigger={<Button><Plus className="size-4" /> {dict.addPatient}</Button>} />
          </>
        }
      />

      <Card>
        {patients.length === 0 ? (
          <Empty message={dict.empty} />
        ) : (
          <>
            {/* Barre de recherche + filtres */}
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
              <div className="relative min-w-45 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={dict.searchPlaceholder}
                  className="pl-8"
                />
              </div>
              <Select
                value={category}
                onChange={(e) => setCategory(e.target.value as "all" | "prothese" | "holter")}
                className="w-auto"
              >
                <option value="all">{dict.catAll}</option>
                <option value="prothese">{dict.catProthese}</option>
                <option value="holter">{dict.catHolter}</option>
              </Select>
              <button
                type="button"
                onClick={() => setOnlyUnbilled((v) => !v)}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors",
                  onlyUnbilled
                    ? "border-primary/40 bg-primary-soft text-primary"
                    : "border-border bg-surface text-foreground/75 hover:bg-background"
                )}
                aria-pressed={onlyUnbilled}
              >
                <Filter className="size-3.5" />
                {dict.onlyUnbilled}
              </button>
              <span className="ml-auto text-xs text-muted">
                {hasFilter ? dict.resultCount(visible.length, patients.length) : dict.patients(patients.length)}
              </span>
            </div>

            {visible.length === 0 ? (
              <Empty message={dict.noMatch} />
            ) : (
              <div className="max-h-[70vh] overflow-auto scrollbar-thin">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      <th className="sticky left-0 top-0 z-30 min-w-55 border-b border-border bg-surface px-3 py-2.5 text-left">
                        {dict.colPatient}
                      </th>
                      {months.map((m) => {
                        const isCurrent = m === currentMonth;
                        return (
                          <th
                            key={m}
                            className={cn(
                              "sticky top-0 z-20 border-b border-border px-2 py-2.5 text-center font-semibold whitespace-nowrap",
                              isCurrent ? "bg-primary-soft text-primary" : "bg-surface"
                            )}
                          >
                            <div className="capitalize">{formatMonth(m, lang)}</div>
                            <div className="mt-0.5 text-[10px] font-normal tabular-nums text-muted">
                              {counts.get(m) ?? 0}/{patients.length}
                            </div>
                          </th>
                        );
                      })}
                      <th className="sticky top-0 z-20 border-b border-border bg-surface px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p) => (
                      <tr key={p.id} className="group">
                        <th
                          scope="row"
                          className="sticky left-0 z-10 min-w-55 border-b border-border bg-surface px-3 py-2 text-left font-normal group-hover:bg-primary-soft"
                        >
                          <div className="truncate font-medium">
                            {patientName(p) || EMPTY}
                            {p.categorie === "holter" && (
                              <span className="ml-1.5 rounded bg-accent-soft px-1 py-0.5 text-[10px] font-semibold text-accent">
                                Holter
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted">
                            {p.type_appareil || EMPTY}
                            {p.date_implantation && ` · ${formatDate(p.date_implantation, lang)}`}
                          </div>
                        </th>

                        {months.map((m) => {
                          const key = cellKey(p.id, m);
                          const v: TriState = cells[key] ?? null;
                          const busy = pendingCells.has(key);
                          const isCurrent = m === currentMonth;
                          return (
                            <td
                              key={m}
                              className={cn(
                                "border-b border-border px-1 py-1 text-center",
                                isCurrent && "bg-primary-soft/40"
                              )}
                            >
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => toggle(p, m)}
                                title={`${formatMonth(m, lang)} — ${dict.cycleHint}`}
                                className={cn(
                                  "inline-flex size-7 items-center justify-center rounded-md border transition-all active:scale-95 disabled:opacity-50",
                                  v === true && "border-success/40 bg-success/15 text-success hover:bg-success/25",
                                  v === false && "border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
                                  v === null && "border-border/70 text-muted hover:border-border hover:bg-background"
                                )}
                                aria-label={v === true ? dict.yes : v === false ? dict.no : dict.notSet}
                              >
                                {v === true ? (
                                  <Check className="size-4" />
                                ) : v === false ? (
                                  <X className="size-4" />
                                ) : (
                                  <Minus className="size-3.5" />
                                )}
                              </button>
                            </td>
                          );
                        })}

                        <td className="border-b border-border bg-surface px-2 py-2 text-right group-hover:bg-primary-soft">
                          <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <PatientDialog
                              mode="edit"
                              patient={p}
                              trigger={
                                <Button size="sm" variant="ghost" aria-label={dict.editPatient}>
                                  <Pencil className="size-3.5" />
                                </Button>
                              }
                            />
                            <RetireButton patientId={p.id} patientLabel={patientName(p)} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

/* ---------- Retirer un patient ---------- */

function RetireButton({ patientId, patientLabel }: { patientId: string; patientLabel: string }) {
  const { tr } = useTr();
  const dict = tr.telecardiologie;
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();

  function retire() {
    if (!window.confirm(dict.confirmRetire)) return;
    start(async () => {
      const res = await retirerPatientTelecardio(patientId, patientLabel);
      if (!res.ok) toast(res.error);
      else {
        toast(tr.toast.saved);
        router.refresh();
      }
    });
  }

  return (
    <Button size="sm" variant="ghost" loading={pending} onClick={retire} aria-label={dict.retirePatient}>
      <Trash2 className="size-3.5 text-danger" />
    </Button>
  );
}

/* ---------- Ajouter / modifier un patient ---------- */

const EMPTY_FORM = {
  nom: "",
  prenom: "",
  sexe: "",
  date_naissance: "",
  date_implantation: "",
  date_debut_hm: "",
  num_serie: "",
  num_pid: "",
  type_appareil: "",
  categorie: "prothese" as "prothese" | "holter",
  commentaire: "",
};

function patientToForm(p: TelecardioPatient): typeof EMPTY_FORM {
  return {
    nom: p.nom ?? "",
    prenom: p.prenom ?? "",
    sexe: p.sexe ?? "",
    date_naissance: p.date_naissance ?? "",
    date_implantation: p.date_implantation ?? "",
    date_debut_hm: p.date_debut_hm ?? "",
    num_serie: p.num_serie ?? "",
    num_pid: p.num_pid ?? "",
    type_appareil: p.type_appareil ?? "",
    categorie: p.categorie,
    commentaire: p.commentaire ?? "",
  };
}

function PatientDialog({
  mode,
  patient,
  trigger,
}: {
  mode: "add" | "edit";
  patient?: TelecardioPatient;
  trigger: React.ReactNode;
}) {
  const { tr } = useTr();
  const dict = tr.telecardiologie;
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [form, setForm] = useState(EMPTY_FORM);

  function openDialog() {
    setForm(mode === "edit" && patient ? patientToForm(patient) : EMPTY_FORM);
    setError(null);
    setOpen(true);
  }

  const set = <K extends keyof typeof EMPTY_FORM>(k: K, val: (typeof EMPTY_FORM)[K]) =>
    setForm((f) => ({ ...f, [k]: val }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nom.trim()) {
      setError(dict.fieldNom);
      return;
    }
    const payload = { ...form };
    start(async () => {
      setError(null);
      const res: Result =
        mode === "edit" && patient
          ? await modifierPatientTelecardio(patient.id, payload)
          : await ajouterPatientTelecardio(payload);
      if (!res.ok) setError(res.error);
      else {
        setOpen(false);
        toast(tr.toast.saved);
        router.refresh();
      }
    });
  }

  return (
    <>
      <span onClick={openDialog} className="contents">
        {trigger}
      </span>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={mode === "edit" ? dict.editPatient : dict.addPatient}
        icon={<HeartPulse />}
      >
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={dict.fieldPrenom}>
              <Input value={form.prenom} onChange={(e) => set("prenom", e.target.value)} autoFocus />
            </Field>
            <Field label={dict.fieldNom}>
              <Input value={form.nom} onChange={(e) => set("nom", e.target.value)} />
            </Field>
            <Field label={dict.fieldSexe}>
              <Select value={form.sexe} onChange={(e) => set("sexe", e.target.value)}>
                <option value="">{dict.notSet}</option>
                <option value="M">M</option>
                <option value="F">F</option>
              </Select>
            </Field>
            <Field label={dict.fieldCategorie}>
              <Select
                value={form.categorie}
                onChange={(e) => set("categorie", e.target.value as "prothese" | "holter")}
              >
                <option value="prothese">{dict.catProthese}</option>
                <option value="holter">{dict.catHolter}</option>
              </Select>
            </Field>
            <Field label={dict.fieldNaissance}>
              <Input type="date" value={form.date_naissance} onChange={(e) => set("date_naissance", e.target.value)} />
            </Field>
            <Field label={dict.fieldImplantation}>
              <Input
                type="date"
                value={form.date_implantation}
                onChange={(e) => set("date_implantation", e.target.value)}
              />
            </Field>
            <Field label={dict.fieldDebutHM}>
              <Input type="date" value={form.date_debut_hm} onChange={(e) => set("date_debut_hm", e.target.value)} />
            </Field>
            <Field label={dict.fieldType}>
              <Input
                value={form.type_appareil}
                onChange={(e) => set("type_appareil", e.target.value)}
                placeholder="Edora 8 DR-T"
              />
            </Field>
            <Field label={dict.fieldSerie}>
              <Input value={form.num_serie} onChange={(e) => set("num_serie", e.target.value)} />
            </Field>
            <Field label={dict.fieldPID}>
              <Input value={form.num_pid} onChange={(e) => set("num_pid", e.target.value)} />
            </Field>
          </div>
          <Field label={dict.fieldComment}>
            <Input value={form.commentaire} onChange={(e) => set("commentaire", e.target.value)} />
          </Field>
          {error && <p className="text-xs font-medium text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tr.common.cancel}
            </Button>
            <Button type="submit" loading={pending}>
              {dict.save}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
