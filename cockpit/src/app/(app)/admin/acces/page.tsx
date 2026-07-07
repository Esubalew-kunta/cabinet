import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AccesClient } from "./client";
import type { AppMember } from "@/lib/types";

export default async function AccesPage() {
  const session = await getSession();
  if (!can(session, "gestion_comptes")) redirect(homeFor(session.member));

  // service role : la page est déjà protégée par la permission ci-dessus
  const admin = supabaseAdmin();
  const [{ data: permissions }, { data: members }, { data: personnel }] = await Promise.all([
    admin.from("app_permissions").select("*"),
    admin.from("app_members").select("*").order("created_at"),
    admin.from("personnel").select("notion_id, nom, email, role, actif").order("nom"),
  ]);

  return (
    <AccesClient
      permissions={permissions ?? []}
      members={(members ?? []) as AppMember[]}
      personnel={personnel ?? []}
      selfId={session.member.id}
    />
  );
}
