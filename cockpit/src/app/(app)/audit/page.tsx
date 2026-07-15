import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AutoSubmitSelect } from "@/components/ui/auto-submit-select";
import { Button } from "@/components/ui/button";
import { ScrollText, Download } from "lucide-react";
import type { AuditEntry } from "@/lib/types";
import type { Tone } from "@/lib/labels";

const ACTION_TONE: Record<string, Tone> = {
  create: "green", update: "blue", delete: "red", verify: "violet",
  assign: "blue", reserve: "violet", return: "green", collect: "green", penalty: "orange",
  stock_move: "yellow", interpret: "violet", send: "blue", status: "gray", setting: "orange",
};

function fmt(at: string) {
  return new Date(at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; who?: string; action?: string; area?: string; from?: string; to?: string }>;
}) {
  const session = await getSession();
  const isAdmin = session.member.is_owner || session.member.role === "admin";
  if (!isAdmin) redirect(homeFor(session.member));
  const { tr } = await getTr();

  const { q, who, action, area, from, to } = await searchParams;
  const admin = supabaseAdmin();

  let query = admin.from("audit_log").select("*").order("at", { ascending: false }).limit(300);
  if (who) query = query.eq("actor_email", who);
  if (action) query = query.eq("action", action);
  if (area) query = query.eq("area", area);
  if (from) query = query.gte("at", from);
  if (to) query = query.lte("at", `${to}T23:59:59`);
  if (q) query = query.or(`target_label.ilike.%${q}%,target_id.ilike.%${q}%,actor_nom.ilike.%${q}%,actor_email.ilike.%${q}%`);

  const [{ data: rows }, { data: actors }] = await Promise.all([
    query.then((r) => ({ data: (r.data ?? []) as AuditEntry[] })),
    admin.from("audit_log").select("actor_email, actor_nom").not("actor_email", "is", null).then((r) => ({ data: r.data ?? [] })),
  ]);

  const actorList = [...new Map((actors ?? []).map((a: { actor_email: string | null; actor_nom: string | null }) => [a.actor_email, a.actor_nom])).entries()];
  const actionKeys = Object.keys(ACTION_TONE);
  const areaKeys = ["patients", "dossiers", "taches", "examens", "appareils", "paiements", "perfusions", "stock", "abonnes", "parametres"];

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ q, who, action, area, from, to })) if (v) qs.set(k, v);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<ScrollText />}
        title={tr.audit.title}
        subtitle={tr.audit.subtitle}
        actions={
          <Link href={`/api/audit/export${qs.toString() ? `?${qs}` : ""}`} prefetch={false}>
            <Button size="sm" variant="secondary"><Download className="size-3.5" /> {tr.audit.export}</Button>
          </Link>
        }
      />

      <form className="flex flex-wrap items-end gap-2">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder={tr.audit.searchPlaceholder}
          className="h-9 w-56 rounded-lg border border-border bg-surface px-3 text-sm shadow-sm focus:outline-2 focus:outline-ring"
        />
        <AutoSubmitSelect name="who" defaultValue={who ?? ""}>
          <option value="">{tr.audit.allWho}</option>
          {actorList.map(([email, nom]) => (
            <option key={email} value={email ?? ""}>{nom || email}</option>
          ))}
        </AutoSubmitSelect>
        <AutoSubmitSelect name="action" defaultValue={action ?? ""}>
          <option value="">{tr.audit.allActions}</option>
          {actionKeys.map((a) => (
            <option key={a} value={a}>{tr.audit.actions[a] ?? a}</option>
          ))}
        </AutoSubmitSelect>
        <AutoSubmitSelect name="area" defaultValue={area ?? ""}>
          <option value="">{tr.audit.allAreas}</option>
          {areaKeys.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </AutoSubmitSelect>
        <input type="date" name="from" defaultValue={from ?? ""} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm shadow-sm" />
        <input type="date" name="to" defaultValue={to ?? ""} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm shadow-sm" />
        <Button size="sm" type="submit">{tr.audit.apply}</Button>
        <Link href="/audit" className="text-xs text-muted underline-offset-2 hover:underline">{tr.audit.clear}</Link>
      </form>

      <Card>
        <CardHeader icon={<ScrollText />} title={tr.audit.title} subtitle={tr.audit.count(rows.length)} />
        {rows.length === 0 ? (
          <Empty message={tr.audit.empty} />
        ) : (
          <Table>
            <THead>
              <th>{tr.audit.colWhen}</th><th>{tr.audit.colWho}</th><th>{tr.audit.colAction}</th><th>{tr.audit.colArea}</th><th>{tr.audit.colTarget}</th>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <td className="whitespace-nowrap text-xs tabular-nums">{fmt(r.at)}</td>
                  <td className="text-sm">{r.actor_nom || r.actor_email || "—"}</td>
                  <td><Badge tone={ACTION_TONE[r.action] ?? "gray"}>{tr.audit.actions[r.action] ?? r.action}</Badge></td>
                  <td className="text-xs">{r.area ?? "—"}</td>
                  <td className="text-xs">{r.target_label || r.target_id || "—"}</td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
