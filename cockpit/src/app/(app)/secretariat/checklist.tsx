"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ListChecks, Pencil, Plus, Sunrise, Sunset, Trash2, X } from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/toast";
import { useTr } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import { cocherChecklist, creerChecklistItem, majChecklistItem, retirerChecklistItem } from "@/lib/actions";
import type { ChecklistItem } from "@/lib/types";

export type TickDuJour = { item_id: string; fait_par: string | null };

/**
 * La checklist de passation du PRD (B.5.4) : une liste le matin, une le soir, cochées par
 * le secrétariat, définies par l'administration.
 *
 * Les coches sont datées côté base : cette carte ne reçoit QUE celles d'aujourd'hui, donc
 * la « remise à zéro quotidienne » demandée est structurelle — il n'y a rien à réinitialiser.
 */
export function ChecklistCard({
  items,
  ticks,
  noms,
  isAdmin,
}: {
  items: ChecklistItem[];
  ticks: TickDuJour[];
  /** personnel.notion_id → nom, pour afficher qui a coché. */
  noms: Record<string, string>;
  isAdmin: boolean;
}) {
  const { tr } = useTr();
  const dict = tr.checklist;
  const coches = new Map(ticks.map((t) => [t.item_id, t]));
  const total = items.length;
  const faits = items.filter((i) => coches.has(i.id)).length;

  return (
    <Card>
      <CardHeader
        icon={<ListChecks />}
        title={dict.title}
        subtitle={dict.subtitle}
        action={
          total > 0 ? (
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                faits === total ? "bg-success-soft text-success" : "bg-background text-muted"
              )}
            >
              {dict.progress(faits, total)}
            </span>
          ) : undefined
        }
      />
      <CardBody>
        {total === 0 && !isAdmin ? (
          <span className="text-sm text-muted">{dict.empty}</span>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {(["Matin", "Soir"] as const).map((moment) => (
              <Colonne
                key={moment}
                moment={moment}
                items={items.filter((i) => i.moment === moment)}
                coches={coches}
                noms={noms}
                isAdmin={isAdmin}
              />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Colonne({
  moment,
  items,
  coches,
  noms,
  isAdmin,
}: {
  moment: "Matin" | "Soir";
  items: ChecklistItem[];
  coches: Map<string, TickDuJour>;
  noms: Record<string, string>;
  isAdmin: boolean;
}) {
  const { tr } = useTr();
  const dict = tr.checklist;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        {moment === "Matin" ? <Sunrise className="size-3.5" /> : <Sunset className="size-3.5" />}
        {moment === "Matin" ? dict.morning : dict.evening}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted">{dict.emptySlot}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <Ligne key={item.id} item={item} tick={coches.get(item.id)} noms={noms} isAdmin={isAdmin} />
          ))}
        </ul>
      )}
      {isAdmin && <AjouterItem moment={moment} />}
    </div>
  );
}

function Ligne({
  item,
  tick,
  noms,
  isAdmin,
}: {
  item: ChecklistItem;
  tick: TickDuJour | undefined;
  noms: Record<string, string>;
  isAdmin: boolean;
}) {
  const [pending, start] = useTransition();
  const [edition, setEdition] = useState(false);
  const [libelle, setLibelle] = useState(item.libelle);
  const [confirmDel, setConfirmDel] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const { tr } = useTr();
  const dict = tr.checklist;
  const coche = Boolean(tick);
  const par = tick?.fait_par ? noms[tick.fait_par] : null;

  function basculer() {
    start(async () => {
      const res = await cocherChecklist(item.id, !coche);
      if (!res.ok) toast(res.error, "error");
      router.refresh();
    });
  }

  function renommer() {
    start(async () => {
      const res = await majChecklistItem(item.id, { libelle });
      if (!res.ok) toast(res.error, "error");
      else setEdition(false);
      router.refresh();
    });
  }

  function retirer() {
    start(async () => {
      const res = await retirerChecklistItem(item.id);
      if (!res.ok) toast(res.error, "error");
      router.refresh();
    });
  }

  if (edition) {
    return (
      <li className="flex items-center gap-1.5">
        <Input value={libelle} onChange={(e) => setLibelle(e.target.value)} className="h-7 text-xs" autoFocus />
        <Button size="sm" onClick={renommer} loading={pending} aria-label={tr.common.save}>
          <Check className="size-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setLibelle(item.libelle); setEdition(false); }}>
          <X className="size-3.5" />
        </Button>
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-2">
      <button
        type="button"
        onClick={basculer}
        disabled={pending}
        aria-pressed={coche}
        className={cn(
          "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors disabled:opacity-50",
          coche ? "border-success bg-success text-white" : "border-border bg-surface hover:border-ring"
        )}
      >
        {coche && <Check className="size-3.5" />}
      </button>
      <span className={cn("min-w-0 flex-1 text-sm", coche && "text-muted line-through")}>
        {item.libelle}
        {par && <span className="ml-1.5 text-[11px] text-muted">· {par}</span>}
      </span>
      {isAdmin && !confirmDel && (
        <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => setEdition(true)}
            className="cursor-pointer rounded p-1 text-muted hover:bg-background hover:text-foreground"
            aria-label={tr.common.edit}
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setConfirmDel(true)}
            className="cursor-pointer rounded p-1 text-muted hover:bg-background hover:text-danger"
            aria-label={dict.removeItem}
          >
            <Trash2 className="size-3.5" />
          </button>
        </span>
      )}
      {isAdmin && confirmDel && (
        <span className="flex shrink-0 items-center gap-1 text-[11px]">
          <span className="text-muted">{dict.removeConfirm}</span>
          <Button size="sm" variant="danger" onClick={retirer} loading={pending}>{tr.common.yes}</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>{tr.common.no}</Button>
        </span>
      )}
    </li>
  );
}

function AjouterItem({ moment }: { moment: "Matin" | "Soir" }) {
  const [open, setOpen] = useState(false);
  const [libelle, setLibelle] = useState("");
  const [dest, setDest] = useState<"Matin" | "Soir">(moment);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const { tr } = useTr();
  const dict = tr.checklist;

  function ajouter() {
    if (!libelle.trim()) return;
    start(async () => {
      const res = await creerChecklistItem({ libelle, moment: dest });
      if (!res.ok) toast(res.error, "error");
      else {
        setLibelle("");
        setOpen(false);
      }
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex cursor-pointer items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
      >
        <Plus className="size-3.5" /> {dict.addItem}
      </button>
    );
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-background/50 p-2">
      <Input
        value={libelle}
        onChange={(e) => setLibelle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && ajouter()}
        placeholder={dict.addPlaceholder}
        className="h-7 text-xs"
        autoFocus
      />
      <div className="flex items-center gap-1.5">
        <Select value={dest} onChange={(e) => setDest(e.target.value as "Matin" | "Soir")} className="h-7 text-xs">
          <option value="Matin">{dict.morning}</option>
          <option value="Soir">{dict.evening}</option>
        </Select>
        <Button size="sm" onClick={ajouter} loading={pending} disabled={!libelle.trim()}>
          {dict.add}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setLibelle(""); setOpen(false); }}>
          {tr.common.cancel}
        </Button>
      </div>
    </div>
  );
}
