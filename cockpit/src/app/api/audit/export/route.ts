import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AuditEntry } from "@/lib/types";

/** Export CSV du journal d'audit (réservé admin/owner), filtres identiques à la page. */
export async function GET(req: NextRequest) {
  const session = await getSession().catch(() => null);
  if (!session || !(session.member.is_owner || session.member.role === "admin")) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const admin = supabaseAdmin();
  let query = admin.from("audit_log").select("*").order("at", { ascending: false }).limit(10000);
  const who = sp.get("who"), action = sp.get("action"), area = sp.get("area"), from = sp.get("from"), to = sp.get("to"), q = sp.get("q");
  if (who) query = query.eq("actor_email", who);
  if (action) query = query.eq("action", action);
  if (area) query = query.eq("area", area);
  if (from) query = query.gte("at", from);
  if (to) query = query.lte("at", `${to}T23:59:59`);
  if (q) query = query.or(`target_label.ilike.%${q}%,target_id.ilike.%${q}%,actor_nom.ilike.%${q}%,actor_email.ilike.%${q}%`);

  const { data } = await query;
  const rows = (data ?? []) as AuditEntry[];

  const esc = (v: unknown) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["at", "actor_nom", "actor_email", "action", "area", "target_label", "target_id", "detail"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([r.at, r.actor_nom, r.actor_email, r.action, r.area, r.target_label, r.target_id, r.detail].map(esc).join(","));
  }
  const csv = "﻿" + lines.join("\n"); // BOM for Excel accents

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
