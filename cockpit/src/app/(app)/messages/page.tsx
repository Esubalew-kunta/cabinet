import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getPersonnelMap } from "@/lib/data";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { MessagerieBoard } from "./interactive";
import { MessageSquare } from "lucide-react";
import type { Conversation, Message } from "@/lib/types";

/**
 * Messagerie équipe ↔ admin.
 *
 * Demandé en réunion : l'équipe écrit à la Dre des remarques et des choses à savoir
 * (« il faut acheter X pour le cabinet ») — ce ne sont PAS des tâches : ni échéance,
 * ni priorité, ni statut. Elle répond depuis sa boîte de réception.
 *
 * Une conversation par membre, avec l'admin uniquement (pas de membre à membre).
 * Pas de temps réel : la pastille et la liste se rafraîchissent à la navigation.
 *
 * La confidentialité tient à la RLS (012_messages.sql), pas à ce rendu : une server
 * action est joignable en POST direct quoi qu'affiche la page.
 */
export default async function MessagesPage() {
  const session = await getSession();
  if (!can(session, "messages")) redirect(homeFor(session.member));
  const { lang, tr } = await getTr();

  const isAdmin = session.member.is_owner || session.member.role === "admin";
  const supa = await supabaseServer();

  // RLS : un membre ne reçoit que SA conversation, l'admin les reçoit toutes.
  const [{ data: convData }, { data: msgData }, personnelMap] = await Promise.all([
    supa.from("conversations").select("*").order("dernier_message_at", { ascending: false }),
    supa.from("messages").select("*").order("created_at", { ascending: true }).limit(500),
    getPersonnelMap(),
  ]);

  const conversations = (convData ?? []) as Conversation[];
  const messages = (msgData ?? []) as Message[];

  const msgsByConv = new Map<string, Message[]>();
  for (const m of messages) {
    msgsByConv.set(m.conversation_id, [...(msgsByConv.get(m.conversation_id) ?? []), m]);
  }

  const fils = conversations.map((c) => ({
    conversation: c,
    nom: personnelMap.get(c.personnel_notion_id) ?? "?",
    messages: msgsByConv.get(c.id) ?? [],
    nonLu: (() => {
      const lu = isAdmin ? c.lu_admin_at : c.lu_membre_at;
      return !lu || new Date(c.dernier_message_at) > new Date(lu);
    })(),
  }));

  // Un membre sans fiche Personnel ne peut pas avoir de conversation (la clé, c'est
  // personnel_notion_id) : autant le dire clairement plutôt que d'échouer à l'envoi.
  const orphelin = !isAdmin && !session.member.personnel_notion_id;

  return (
    <div className="space-y-4">
      <PageHeader icon={<MessageSquare />} title={tr.messages.title} subtitle={tr.messages.subtitle} />
      {orphelin ? (
        <Card>
          <CardBody>{tr.messages.noPersonnelRecord}</CardBody>
        </Card>
      ) : (
        <MessagerieBoard lang={lang} isAdmin={isAdmin} fils={fils} moiMemberId={session.member.id} />
      )}
      <p className="text-xs text-muted">{tr.messages.hint}</p>
    </div>
  );
}
