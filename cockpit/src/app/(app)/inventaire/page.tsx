import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPersonnel } from "@/lib/data";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr, Empty } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { STATUT_STOCK } from "@/lib/labels";
import { formatDate, EMPTY } from "@/lib/utils";
import { tv } from "@/lib/i18n/dict";
import {
  NouvelArticleButton,
  MouvementStockButton,
  SeuilArticle,
  HistoriqueArticleButton,
} from "@/components/interactive";
import { Package, TriangleAlert } from "lucide-react";
import type { Article, Mouvement } from "@/lib/types";

/**
 * Les consommables du cabinet. Le journal des mouvements fait foi : chaque
 * réappro / sortie est une ligne tracée, la quantité est le total courant.
 * Sous le seuil → alerte réappro (bannière + rappel n8n).
 */
export default async function InventairePage() {
  const session = await getSession();
  if (!can(session, "stock")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();
  const isAdmin = session.member.is_owner || session.member.role === "admin";

  const supa = await supabaseServer();
  const [articles, mouvements, personnel] = await Promise.all([
    supa.from("stock").select("*").order("article").then((r) => (r.data ?? []) as Article[]),
    supa.from("stock_mouvements").select("*").order("date_mouvement", { ascending: false }).limit(300)
      .then((r) => (r.data ?? []) as Mouvement[]),
    getPersonnel(),
  ]);

  const statut = (a: Article): keyof typeof STATUT_STOCK => {
    const q = Number(a.quantite ?? 0);
    if (q === 0) return "Rupture";
    if (q <= Number(a.seuil_minimum ?? 0)) return "Bas";
    return "OK";
  };
  const bas = articles.filter((a) => statut(a) !== "OK");
  const mouvementsPar = new Map<string, Mouvement[]>();
  for (const m of mouvements) {
    const aid = m.article?.[0];
    if (!aid) continue;
    const list = mouvementsPar.get(aid) ?? [];
    list.push(m);
    mouvementsPar.set(aid, list);
  }
  const staffList = personnel.map((p) => ({ notion_id: p.notion_id, nom: p.nom }));

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Package />}
        title={tr.inventaire.title}
        subtitle={tr.inventaire.subtitle}
        actions={isAdmin ? <NouvelArticleButton /> : undefined}
      />

      {/* Bannière stock bas : la chose à traiter en premier */}
      {articles.length > 0 && (
        <div
          className={`rise-in flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium ${
            bas.length > 0
              ? "border-warning/40 bg-warning-soft text-warning"
              : "border-success/30 bg-success-soft text-success"
          }`}
        >
          <TriangleAlert className="size-4 shrink-0" />
          <span>
            {bas.length > 0
              ? `${tr.inventaire.lowStockBanner(bas.length)} : ${bas.map((a) => a.article).join(", ")}`
              : tr.inventaire.allGood}
          </span>
        </div>
      )}

      <Card>
        <CardHeader icon={<Package />} title={tr.inventaire.title} subtitle={tr.inventaire.historySub} />
        {articles.length === 0 ? (
          <Empty message={tr.inventaire.empty} />
        ) : (
          <Table>
            <THead>
              <th>{tr.inventaire.colArticle}</th><th>{tr.inventaire.colCategory}</th><th className="text-right">{tr.inventaire.colQty}</th><th>{tr.inventaire.colThreshold}</th><th>{tr.common.status}</th><th>{tr.inventaire.colLastRestock}</th><th>{tr.inventaire.colSupplier}</th><th></th>
            </THead>
            <TBody>
              {articles.map((a) => {
                const s = statut(a);
                return (
                  <Tr key={a.notion_id}>
                    <td className="font-medium">{a.article ?? EMPTY}</td>
                    <td className="text-xs">{tv(lang, a.categorie) ?? EMPTY}</td>
                    <td className={`text-right tabular-nums font-semibold ${s !== "OK" ? "text-danger" : ""}`}>
                      {a.quantite ?? 0}{a.unite ? <span className="ml-1 text-xs font-normal text-muted">{a.unite}</span> : null}
                    </td>
                    <td><SeuilArticle articleId={a.notion_id} seuil={a.seuil_minimum} /></td>
                    <td><StatusBadge value={s} map={STATUT_STOCK} /></td>
                    <td className="whitespace-nowrap text-xs">{formatDate(a.dernier_reappro, lang)}</td>
                    <td className="text-xs">{a.fournisseur ?? EMPTY}</td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <MouvementStockButton article={a} sens="Entrée" personnel={staffList} defaultPar={session.member.personnel_notion_id} />
                        <MouvementStockButton article={a} sens="Sortie" personnel={staffList} defaultPar={session.member.personnel_notion_id} />
                        <HistoriqueArticleButton article={a} mouvements={mouvementsPar.get(a.notion_id) ?? []} personnel={staffList} />
                      </div>
                    </td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
