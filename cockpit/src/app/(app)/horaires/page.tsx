import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getSecretaires, getSettingsMap } from "@/lib/data";
import { PageHeader } from "@/components/ui/page-header";
import { CalendarRange } from "lucide-react";
import { mondayOf, weekDates, monthDates, isoDate, secretaryColor } from "@/lib/horaires";
import type { Horaire } from "@/lib/types";
import { HorairesBoard } from "./interactive";

/**
 * Horaires secrétariat : calendrier des heures de travail (grille ou Gantt),
 * + couverture / trous. Écriture Supabase-first, miroir Notion en arrière-plan.
 * Fenêtre chargée = toutes les semaines qui touchent le mois de l'ancre, ce qui
 * couvre la vue mois ET n'importe quelle vue semaine de ce mois.
 */
export default async function HorairesPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; v?: string }>;
}) {
  const session = await getSession();
  if (!can(session, "planning")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();
  const { d, v } = await searchParams;

  const today = isoDate(new Date());
  const anchor = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today;
  const view: "week" | "month" = v === "month" ? "month" : "week";

  const settings = await getSettingsMap();
  const opStart = settings.get("operating_hours_start") || "08:00";
  const opEnd = settings.get("operating_hours_end") || "19:00";
  const selfEditEnabled = (settings.get("secretary_self_edit") || "on") !== "off";

  const secretaires = await getSecretaires();
  const orderedIds = secretaires.map((s) => s.notion_id);
  const secList = secretaires.map((s) => ({
    id: s.notion_id,
    nom: s.nom ?? "?",
    color: secretaryColor(s.notion_id, orderedIds),
  }));

  const monthAll = monthDates(anchor);
  const from = mondayOf(monthAll[0]);
  const to = weekDates(monthAll[monthAll.length - 1])[6];

  const supa = await supabaseServer();
  const { data } = await supa
    .from("horaires_secretariat")
    .select("*")
    .gte("date", from)
    .lte("date", to)
    .order("date")
    .order("debut");
  const blocks = (data ?? []) as Horaire[];

  const isAdmin = session.member.is_owner || session.member.role === "admin";

  return (
    <div className="space-y-4">
      <PageHeader icon={<CalendarRange />} title={tr.horaires.title} subtitle={tr.horaires.subtitle} />
      <HorairesBoard
        lang={lang}
        anchor={anchor}
        view={view}
        blocks={blocks}
        secretaires={secList}
        opStart={opStart}
        opEnd={opEnd}
        canEditAll={isAdmin}
        selfEditEnabled={selfEditEnabled}
        myId={session.member.personnel_notion_id}
      />
    </div>
  );
}
