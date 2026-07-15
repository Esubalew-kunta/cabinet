"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, ChevronLeft, ChevronRight, Plus, Trash2, LayoutGrid, GanttChartSquare, TriangleAlert } from "lucide-react";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Field } from "@/components/ui/input";
import { useToast } from "@/components/toast";
import { useTr } from "@/components/i18n-provider";
import { getDict } from "@/lib/i18n/dict";
import { cn } from "@/lib/utils";
import { creerHoraire, majHoraire, supprimerHoraire } from "@/lib/actions";
import {
  toMinutes,
  blockHours,
  coveredHours,
  gapIntervals,
  coveredIntervals,
  weekDates,
  monthDates,
  mondayOf,
  addDays,
  addMonths,
  isValidRange,
  overlaps,
  fromMinutes,
  periodDates,
  periodBlocks,
} from "@/lib/horaires";
import type { Horaire } from "@/lib/types";

type Sec = { id: string; nom: string; color: string };
type Lang = "fr" | "en";

type Props = {
  lang: Lang;
  anchor: string;
  view: "week" | "month";
  blocks: Horaire[];
  secretaires: Sec[];
  opStart: string;
  opEnd: string;
  canEditAll: boolean;
  selfEditEnabled: boolean;
  myId: string | null;
};

const HOUR_PX = 44;

// alpha hex sur une couleur #rrggbb
function tint(hex: string, alpha: number) {
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `${hex}${a}`;
}

export function HorairesBoard(props: Props) {
  const { lang, anchor, view, blocks, secretaires, opStart, opEnd, canEditAll, selfEditEnabled, myId } = props;
  const router = useRouter();
  const dict = useTr().tr.horaires;

  const [layout, setLayout] = useState<"grid" | "gantt">("grid");
  const [filter, setFilter] = useState<string>("all");
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const colorOf = useMemo(() => new Map(secretaires.map((s) => [s.id, s.color])), [secretaires]);
  const nameOf = useMemo(() => new Map(secretaires.map((s) => [s.id, s.nom])), [secretaires]);

  // Qui la personne connectée peut-elle éditer ?
  const canEditSec = (secId: string) => canEditAll || (selfEditEnabled && !!myId && myId === secId);
  const canAddAny = canEditAll || (selfEditEnabled && !!myId && secretaires.some((s) => s.id === myId));

  const shown = filter === "all" ? blocks : blocks.filter((b) => b.secretaire_notion_id === filter);

  // Navigation (serveur : change la fenêtre chargée)
  const go = (d: string, v: "week" | "month" = view) => router.push(`/horaires?d=${d}&v=${v}`);
  const navPrev = () => go(view === "week" ? addDays(anchor, -7) : addMonths(anchor, -1));
  const navNext = () => go(view === "week" ? addDays(anchor, 7) : addMonths(anchor, 1));
  const navToday = () => go(new Date().toISOString().slice(0, 10));

  const week = weekDates(anchor);
  const weekBlocks = shown.filter((b) => b.date >= week[0] && b.date <= week[6]);

  // Totaux du bas : suivent l'onglet semaine/mois (voir periodBlocks pour le débord de mois).
  const panelDays = periodDates(view, anchor);
  const panelBlocks = periodBlocks(view, anchor, shown);

  const openAdd = (date: string, secId?: string, start?: string) =>
    setDialog({ mode: "add", date, secId: secId ?? (myId && !canEditAll ? myId : secretaires[0]?.id ?? ""), debut: start ?? opStart, fin: fromMinutes(toMinutes(start ?? opStart) + 120) });
  const openEdit = (b: Horaire) =>
    setDialog({ mode: "edit", id: b.id, date: b.date, secId: b.secretaire_notion_id, debut: b.debut, fin: b.fin, note: b.note ?? "", recurringGroup: b.recurring_group_id });

  const rangeLabel =
    view === "week"
      ? dict.weekOf(fmtDay(week[0], lang) + " – " + fmtDay(week[6], lang))
      : new Date(anchor + "T00:00:00").toLocaleDateString(lang, { month: "long", year: "numeric" });

  return (
    <div className="space-y-4">
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={navPrev} aria-label={dict.prev}><ChevronLeft className="size-4" /></Button>
          <Button variant="secondary" size="sm" onClick={navToday}>{dict.today}</Button>
          <Button variant="secondary" size="sm" onClick={navNext} aria-label={dict.next}><ChevronRight className="size-4" /></Button>
        </div>
        <span className="font-display text-sm font-semibold capitalize">{rangeLabel}</span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Vue semaine / mois */}
          <Segmented
            value={view}
            options={[{ v: "week", label: dict.viewWeek }, { v: "month", label: dict.viewMonth }]}
            onChange={(v) => go(anchor, v as "week" | "month")}
          />
          {/* Disposition grille / gantt (semaine seulement) */}
          {view === "week" && (
            <Segmented
              value={layout}
              options={[
                { v: "grid", label: dict.layoutGrid, icon: <LayoutGrid className="size-3.5" /> },
                { v: "gantt", label: dict.layoutGantt, icon: <GanttChartSquare className="size-3.5" /> },
              ]}
              onChange={(v) => setLayout(v as "grid" | "gantt")}
            />
          )}
          {/* Filtre secrétaire */}
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-auto">
            <option value="all">{dict.allSecretaries}</option>
            {secretaires.map((s) => (
              <option key={s.id} value={s.id}>{s.nom}</option>
            ))}
          </Select>
          {canAddAny && (
            <Button size="sm" onClick={() => openAdd(view === "week" ? week[0] : anchor)}>
              <Plus className="size-4" /> {dict.addBlock}
            </Button>
          )}
        </div>
      </div>

      {secretaires.length === 0 ? (
        <Card><div className="p-8 text-center text-sm text-muted">{dict.noSecretaries}</div></Card>
      ) : (
        <>
          {view === "week" && layout === "grid" && (
            <WeekGrid dict={dict} lang={lang} days={week} blocks={weekBlocks} colorOf={colorOf} nameOf={nameOf}
              opStart={opStart} opEnd={opEnd} onAdd={openAdd} onEdit={openEdit} canAdd={canAddAny} />
          )}
          {view === "week" && layout === "gantt" && (
            <WeekGantt dict={dict} lang={lang} days={week} blocks={weekBlocks} secretaires={filter === "all" ? secretaires : secretaires.filter((s) => s.id === filter)}
              opStart={opStart} opEnd={opEnd} onAdd={openAdd} onEdit={openEdit} canEditSec={canEditSec} />
          )}
          {view === "month" && (
            <MonthView dict={dict} lang={lang} anchor={anchor} blocks={shown} secretaires={secretaires}
              onDay={(d) => go(d, "week")} />
          )}

          <CoveragePanel dict={dict} lang={lang} view={view} days={panelDays} blocks={panelBlocks} secretaires={filter === "all" ? secretaires : secretaires.filter((s) => s.id === filter)}
            opStart={opStart} opEnd={opEnd} />
        </>
      )}

      {dialog && (
        <BlockDialog
          dict={dict}
          state={dialog}
          secretaires={secretaires}
          allBlocks={blocks}
          canEditAll={canEditAll}
          myId={myId}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

// ---------- Segmented control ----------
function Segmented({ value, options, onChange }: { value: string; options: { v: string; label: string; icon?: React.ReactNode }[]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 shadow-sm">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.v ? "bg-primary text-white shadow-sm" : "text-muted hover:text-foreground"
          )}
        >
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Vue GRILLE (colonnes = jours, lignes = heures) ----------
function WeekGrid({ dict, lang, days, blocks, colorOf, nameOf, opStart, opEnd, onAdd, onEdit, canAdd }: {
  dict: Dict; lang: Lang; days: string[]; blocks: Horaire[]; colorOf: Map<string, string>; nameOf: Map<string, string>;
  opStart: string; opEnd: string; onAdd: (date: string, secId?: string, start?: string) => void; onEdit: (b: Horaire) => void; canAdd: boolean;
}) {
  // Plage horaire dynamique : englobe les heures d'ouverture ET tous les blocs.
  const starts = blocks.map((b) => toMinutes(b.debut));
  const ends = blocks.map((b) => toMinutes(b.fin));
  const gridStartH = Math.floor(Math.min(toMinutes(opStart), ...(starts.length ? starts : [toMinutes(opStart)])) / 60);
  const gridEndH = Math.ceil(Math.max(toMinutes(opEnd), ...(ends.length ? ends : [toMinutes(opEnd)])) / 60);
  const hours = Array.from({ length: gridEndH - gridStartH }, (_, i) => gridStartH + i);
  const gridTop = gridStartH * 60;
  const height = (gridEndH - gridStartH) * HOUR_PX;
  const today = new Date().toISOString().slice(0, 10);

  const byDay = new Map<string, Horaire[]>();
  for (const b of blocks) (byDay.get(b.date) ?? byDay.set(b.date, []).get(b.date)!).push(b);

  const onColClick = (e: React.MouseEvent<HTMLDivElement>, date: string) => {
    if (!canAdd) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const min = Math.round((gridTop + (y / HOUR_PX) * 60) / 30) * 30;
    onAdd(date, undefined, fromMinutes(Math.max(gridTop, Math.min(gridEndH * 60 - 60, min))));
  };

  return (
    <Card className="overflow-x-auto">
      <div className="min-w-[720px]">
        {/* En-têtes jours */}
        <div className="grid border-b border-border" style={{ gridTemplateColumns: `48px repeat(7, 1fr)` }}>
          <div />
          {days.map((d) => (
            <div key={d} className={cn("px-1 py-2 text-center", d === today && "bg-primary-soft/50")}>
              <div className="text-[11px] uppercase tracking-wide text-muted">{new Date(d + "T00:00:00").toLocaleDateString(lang, { weekday: "short" })}</div>
              <div className={cn("text-sm font-semibold", d === today && "text-primary")}>{new Date(d + "T00:00:00").getDate()}</div>
            </div>
          ))}
        </div>
        {/* Corps : axe horaire + colonnes */}
        <div className="grid" style={{ gridTemplateColumns: `48px repeat(7, 1fr)` }}>
          {/* Axe */}
          <div className="relative" style={{ height }}>
            {hours.map((h) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted" style={{ top: (h - gridStartH) * HOUR_PX }}>
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {/* Jours */}
          {days.map((d) => {
            const laid = layoutDay(byDay.get(d) ?? []);
            return (
              <div key={d} className={cn("relative border-l border-border", d === today && "bg-primary-soft/20")} style={{ height }} onClick={(e) => onColClick(e, d)}>
                {hours.map((h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-border/60" style={{ top: (h - gridStartH) * HOUR_PX }} />
                ))}
                {(byDay.get(d) ?? []).map((b) => {
                  const pos = laid.get(b.id)!;
                  const top = ((toMinutes(b.debut) - gridTop) / 60) * HOUR_PX;
                  const h = Math.max(16, ((toMinutes(b.fin) - toMinutes(b.debut)) / 60) * HOUR_PX);
                  const color = colorOf.get(b.secretaire_notion_id) ?? "#64748b";
                  return (
                    <button
                      key={b.id}
                      onClick={(e) => { e.stopPropagation(); onEdit(b); }}
                      className="absolute overflow-hidden rounded-md border px-1.5 py-1 text-left transition-shadow hover:z-10 hover:shadow-md"
                      style={{
                        top, height: h,
                        left: `calc(${(pos.lane / pos.cols) * 100}% + 2px)`,
                        width: `calc(${100 / pos.cols}% - 4px)`,
                        backgroundColor: tint(color, 0.16),
                        borderColor: color,
                      }}
                      title={`${nameOf.get(b.secretaire_notion_id) ?? ""} ${b.debut}–${b.fin}`}
                    >
                      <span className="block truncate text-[11px] font-semibold" style={{ color }}>{nameOf.get(b.secretaire_notion_id)}</span>
                      <span className="block truncate text-[10px] tabular-nums text-foreground/70">{b.debut}–{b.fin}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {blocks.length === 0 && <div className="border-t border-border p-4 text-center text-xs text-muted">{dict.empty}</div>}
    </Card>
  );
}

// Répartition en couloirs des blocs qui se chevauchent (par cluster).
function layoutDay(dayBlocks: Horaire[]): Map<string, { lane: number; cols: number }> {
  const items = dayBlocks
    .map((b) => ({ id: b.id, s: toMinutes(b.debut), e: toMinutes(b.fin) }))
    .sort((a, b) => a.s - b.s || a.e - b.e);
  const result = new Map<string, { lane: number; cols: number }>();
  let cluster: { id: string; s: number; e: number; lane: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanesEnd: number[] = [];
    for (const it of cluster) {
      let lane = lanesEnd.findIndex((end) => end <= it.s);
      if (lane === -1) { lane = lanesEnd.length; lanesEnd.push(it.e); } else lanesEnd[lane] = it.e;
      it.lane = lane;
    }
    const cols = Math.max(1, lanesEnd.length);
    for (const it of cluster) result.set(it.id, { lane: it.lane, cols });
    cluster = []; clusterEnd = -1;
  };
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) flush();
    cluster.push({ ...it, lane: 0 });
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  flush();
  return result;
}

// ---------- Vue GANTT (par jour : lignes = secrétaires, axe = temps) ----------
function WeekGantt({ dict, lang, days, blocks, secretaires, opStart, opEnd, onAdd, onEdit, canEditSec }: {
  dict: Dict; lang: Lang; days: string[]; blocks: Horaire[]; secretaires: Sec[]; opStart: string; opEnd: string;
  onAdd: (date: string, secId?: string, start?: string) => void; onEdit: (b: Horaire) => void; canEditSec: (id: string) => boolean;
}) {
  const oS = toMinutes(opStart), oE = toMinutes(opEnd);
  const span = Math.max(60, oE - oS);
  const pct = (m: number) => `${((Math.min(Math.max(m, oS), oE) - oS) / span) * 100}%`;
  const hourMarks = Array.from({ length: Math.floor(oE / 60) - Math.ceil(oS / 60) + 1 }, (_, i) => Math.ceil(oS / 60) + i);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card className="overflow-x-auto">
      <div className="min-w-[720px] divide-y divide-border">
        {days.map((d) => {
          const dayBlocks = blocks.filter((b) => b.date === d);
          return (
            <div key={d} className={cn("p-3", d === today && "bg-primary-soft/20")}>
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-sm font-semibold capitalize">{new Date(d + "T00:00:00").toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "short" })}</span>
                <span className="text-xs text-muted">{dict.hoursShort(coveredHours(dayBlocks))}</span>
              </div>
              <div className="space-y-1.5">
                {secretaires.map((s) => {
                  const secBlocks = dayBlocks.filter((b) => b.secretaire_notion_id === s.id);
                  return (
                    <div key={s.id} className="flex items-center gap-2">
                      <span className="w-28 shrink-0 truncate text-xs font-medium" style={{ color: s.color }}>{s.nom}</span>
                      <div
                        className="relative h-6 flex-1 rounded bg-background"
                        onClick={() => canEditSec(s.id) && onAdd(d, s.id)}
                        style={{ cursor: canEditSec(s.id) ? "pointer" : "default" }}
                      >
                        {hourMarks.map((h) => (
                          <div key={h} className="absolute top-0 h-full border-l border-border/50" style={{ left: pct(h * 60) }} />
                        ))}
                        {secBlocks.map((b) => (
                          <button
                            key={b.id}
                            onClick={(e) => { e.stopPropagation(); onEdit(b); }}
                            className="absolute top-0.5 bottom-0.5 flex items-center overflow-hidden rounded px-1 text-[10px] font-medium transition-shadow hover:shadow-md"
                            style={{ left: pct(toMinutes(b.debut)), width: `calc(${pct(toMinutes(b.fin))} - ${pct(toMinutes(b.debut))})`, backgroundColor: tint(s.color, 0.85), color: "#fff" }}
                            title={`${b.debut}–${b.fin}`}
                          >
                            <span className="truncate">{b.debut}–{b.fin}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------- Vue MOIS (résumé condensé par jour) ----------
function MonthView({ dict, lang, anchor, blocks, secretaires, onDay }: {
  dict: Dict; lang: Lang; anchor: string; blocks: Horaire[]; secretaires: Sec[]; onDay: (d: string) => void;
}) {
  const colorOf = new Map(secretaires.map((s) => [s.id, s.color]));
  const initialOf = new Map(secretaires.map((s) => [s.id, (s.nom || "?").trim().charAt(0).toUpperCase()]));
  const monthDays = monthDates(anchor);
  const gridStart = mondayOf(monthDays[0]);
  const cells: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    cells.push(d);
    if (i >= 34 && d >= monthDays[monthDays.length - 1]) break;
  }
  const inMonth = (d: string) => d.slice(0, 7) === anchor.slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);
  const byDay = new Map<string, Horaire[]>();
  for (const b of blocks) (byDay.get(b.date) ?? byDay.set(b.date, []).get(b.date)!).push(b);
  const dow = weekDates(anchor);

  return (
    <Card className="overflow-hidden p-2">
      <div className="grid grid-cols-7 border-b border-border">
        {dow.map((d) => (
          <div key={d} className="px-1 py-1.5 text-center text-[11px] uppercase tracking-wide text-muted">
            {new Date(d + "T00:00:00").toLocaleDateString(lang, { weekday: "short" })}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d) => {
          const list = byDay.get(d) ?? [];
          const secs = Array.from(new Set(list.map((b) => b.secretaire_notion_id)));
          return (
            <button
              key={d}
              onClick={() => onDay(d)}
              className={cn(
                "min-h-[76px] cursor-pointer border-b border-l border-border p-1.5 text-left align-top transition-colors hover:bg-surface/70",
                !inMonth(d) && "bg-background/40 text-muted"
              )}
            >
              <div className={cn("text-xs font-semibold", d === today && "inline-flex size-5 items-center justify-center rounded-full bg-primary text-white")}>
                {new Date(d + "T00:00:00").getDate()}
              </div>
              {list.length > 0 && (
                <>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {secs.slice(0, 4).map((id) => (
                      <span key={id} className="inline-flex size-4 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: colorOf.get(id) ?? "#64748b" }}>
                        {initialOf.get(id) ?? "?"}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 text-[10px] tabular-nums text-muted">{dict.hoursShort(coveredHours(list))}</div>
                </>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ---------- Couverture & analytics (période affichée : semaine ou mois) ----------
function CoveragePanel({ dict, lang, view, days, blocks, secretaires, opStart, opEnd }: {
  dict: Dict; lang: Lang; view: "week" | "month"; days: string[]; blocks: Horaire[]; secretaires: Sec[]; opStart: string; opEnd: string;
}) {
  const oS = toMinutes(opStart), oE = toMinutes(opEnd);
  const span = Math.max(60, oE - oS);
  const staffed = days.reduce((sum, d) => sum + coveredHours(blocks.filter((b) => b.date === d)), 0);
  const perSec = secretaires.map((s) => ({ ...s, hours: blocks.filter((b) => b.secretaire_notion_id === s.id).reduce((a, b) => a + blockHours(b), 0) }));
  const totalIndiv = perSec.reduce((a, s) => a + s.hours, 0);
  const avg = secretaires.length ? totalIndiv / secretaires.length : 0;
  const gapCount = days.reduce((n, d) => n + gapIntervals(blocks.filter((b) => b.date === d), opStart, opEnd).length, 0);
  const pct = (m: number) => ((m - oS) / span) * 100;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={dict.statStaffed(view)} value={dict.hoursShort(staffed)} />
        <StatCard label={dict.statAvg(view)} value={dict.hoursShort(avg)} />
        <StatCard label={dict.statGaps(view)} value={String(gapCount)} tone={gapCount > 0 ? "warning" : "success"} />
      </div>

      <Card>
        <CardHeader icon={<CalendarRange />} title={dict.coverageTitle} subtitle={dict.operating(opStart, opEnd)} />
        <div className="space-y-2 p-4">
          {days.map((d) => {
            const dayBlocks = blocks.filter((b) => b.date === d);
            const covered = coveredIntervals(dayBlocks).filter((iv) => iv.end > oS && iv.start < oE);
            return (
              <div key={d} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs capitalize text-muted">{new Date(d + "T00:00:00").toLocaleDateString(lang, { weekday: "short", day: "numeric" })}</span>
                <div className="relative h-4 flex-1 overflow-hidden rounded bg-danger/15">
                  {covered.map((iv, i) => (
                    <div key={i} className="absolute top-0 h-full bg-success/70" style={{ left: `${pct(Math.max(iv.start, oS))}%`, width: `${pct(Math.min(iv.end, oE)) - pct(Math.max(iv.start, oS))}%` }} />
                  ))}
                </div>
                <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted">{dict.hoursShort(coveredHours(dayBlocks))}</span>
              </div>
            );
          })}
          <div className="flex items-center gap-4 pt-1 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-success/70" />{dict.covered}</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-danger/40" />{dict.gap}</span>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader icon={<CalendarRange />} title={dict.perSecretaryTitle(view)} />
        <div className="divide-y divide-border">
          {perSec.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2">
              <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="flex-1 truncate text-sm">{s.nom}</span>
              <span className="text-sm font-semibold tabular-nums">{dict.hoursShort(s.hours)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------- Dialogue Ajouter / Modifier ----------
type DialogState = {
  mode: "add" | "edit";
  id?: string;
  date: string;
  secId: string;
  debut: string;
  fin: string;
  note?: string;
  recurringGroup?: string | null;
};

function BlockDialog({ dict, state, secretaires, allBlocks, canEditAll, myId, onClose, onSaved }: {
  dict: Dict; state: DialogState; secretaires: Sec[]; allBlocks: Horaire[]; canEditAll: boolean; myId: string | null;
  onClose: () => void; onSaved: () => void;
}) {
  const { tr } = useTr();
  const [secId, setSecId] = useState(state.secId);
  const [date, setDate] = useState(state.date);
  const [debut, setDebut] = useState(state.debut);
  const [fin, setFin] = useState(state.fin);
  const [note, setNote] = useState(state.note ?? "");
  const [repeat, setRepeat] = useState(false);
  const [weeks, setWeeks] = useState(4);
  const [confirmDel, setConfirmDel] = useState<null | "single" | "group">(null);
  const [pending, start] = useTransition();
  const toast = useToast();

  const isEdit = state.mode === "edit";
  // Une secrétaire non-admin ne choisit qu'elle-même (comme responsable).
  const secOptions = canEditAll ? secretaires : secretaires.filter((s) => s.id === myId);
  // L'admin peut changer la secrétaire ET la date même en édition (déplacer le créneau).
  const lockSecretary = isEdit && !canEditAll;

  // Chevauchement en direct (avertissement non bloquant, exclut le bloc édité).
  const clash = allBlocks.some(
    (b) => b.id !== state.id && b.secretaire_notion_id === secId && b.date === date && overlaps({ debut, fin }, b)
  );

  const submit = () => {
    if (!isValidRange(debut, fin)) { toast(dict.invalidRange, "error"); return; }
    start(async () => {
      const res = isEdit
        ? await majHoraire(state.id!, { secretaireId: secId, date, debut, fin, note })
        : await creerHoraire({ secretaireId: secId, date, debut, fin, note, repeatWeeks: repeat ? weeks : 1 });
      if (res.ok) { toast(isEdit ? dict.save : dict.addBlock, "success"); onSaved(); }
      else toast(res.error, "error");
    });
  };

  const doDelete = () => {
    const wholeGroup = confirmDel === "group";
    start(async () => {
      const res = await supprimerHoraire(state.id!, wholeGroup);
      if (res.ok) { toast(dict.delete, "success"); onSaved(); }
      else { toast(res.error, "error"); setConfirmDel(null); }
    });
  };

  return (
    <Dialog open onClose={onClose} title={isEdit ? dict.editBlock : dict.addBlock} icon={<CalendarRange />}>
      <div className="space-y-3">
        <Field label={dict.fieldSecretary}>
          <Select value={secId} onChange={(e) => setSecId(e.target.value)} disabled={lockSecretary}>
            {secOptions.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
          </Select>
        </Field>
        <Field label={dict.fieldDate}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={dict.fieldStart}><Input type="time" value={debut} onChange={(e) => setDebut(e.target.value)} /></Field>
          <Field label={dict.fieldEnd}><Input type="time" value={fin} onChange={(e) => setFin(e.target.value)} /></Field>
        </div>
        <Field label={dict.fieldNote}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={dict.notePlaceholder} />
        </Field>

        {clash && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {dict.overlapWarning}
          </p>
        )}

        {!isEdit && (
          <div className="rounded-lg border border-border bg-background/50 p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
              {dict.repeatLabel}
            </label>
            {repeat && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-muted">{dict.repeatWeeksLabel}</span>
                <Input type="number" min={1} max={52} value={weeks} onChange={(e) => setWeeks(Math.max(1, Math.min(52, Number(e.target.value) || 1)))} className="h-8 w-20" />
              </div>
            )}
            {repeat && <p className="mt-1.5 text-xs text-muted">{dict.repeatHint}</p>}
          </div>
        )}

        {/* Confirmation de suppression intégrée (pas de confirm() navigateur) */}
        {confirmDel ? (
          <div className="rounded-lg border border-danger/40 bg-danger-soft p-3">
            <p className="text-sm font-medium text-danger">
              {confirmDel === "group" ? dict.deleteGroup + " ?" : dict.deleteConfirm}
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <Button variant="danger" size="sm" onClick={doDelete} loading={pending} className="flex-1">{tr.common.yes}</Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDel(null)} disabled={pending} className="flex-1">{tr.common.no}</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 pt-1">
              <Button onClick={submit} loading={pending} className="flex-1">{isEdit ? dict.save : dict.create}</Button>
              {isEdit && (
                <Button variant="danger" onClick={() => setConfirmDel("single")} disabled={pending} aria-label={dict.delete}><Trash2 className="size-4" /></Button>
              )}
            </div>
            {isEdit && state.recurringGroup && (
              <button onClick={() => setConfirmDel("group")} className="w-full text-center text-xs text-muted underline hover:text-danger">{dict.deleteGroup}</button>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

// ---------- utilitaires locaux ----------
function fmtDay(d: string, lang: Lang) {
  return new Date(d + "T00:00:00").toLocaleDateString(lang, { day: "numeric", month: "short" });
}

// ---------- dictionnaire typé (section horaires de dict.ts) ----------
type Dict = ReturnType<typeof getDict>["horaires"];
