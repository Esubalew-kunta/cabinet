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
  const [{ data: convData }, personnelMap] = await Promise.all([
    supa.from("conversations").select("*").order("dernier_message_at", { ascending: false }),
    getPersonnelMap(),
  ]);
  const conversations = (convData ?? []) as Conversation[];

  // Les messages RÉCENTS, par conversation.
  //
  // Un simple .order(created_at asc).limit(500) global renvoie les 500 messages les PLUS
  // ANCIENS de toutes les conversations confondues : passé ce seuil, les nouveaux messages
  // cessent purement et simplement d'apparaître — la boîte gèle sans rien dire.
  // On prend donc les plus RÉCENTS, puis on rétablit l'ordre chronologique pour l'affichage.
  const MAX_PAR_FIL = 100;
  const msgsByConv = new Map<string, Message[]>();
  if (conversations.length > 0) {
    const { data: msgData } = await supa
      .from("messages")
      .select("*")
      .in(
        "conversation_id",
        conversations.map((c) => c.id)
      )
      .order("created_at", { ascending: false }) // les plus récents d'abord…
      .limit(MAX_PAR_FIL * Math.max(1, conversations.length));

    for (const m of ((msgData ?? []) as Message[]).reverse()) {
      // …puis .reverse() rend l'ordre chronologique attendu à l'écran.
      const liste = msgsByConv.get(m.conversation_id) ?? [];
      liste.push(m);
      msgsByConv.set(m.conversation_id, liste);
    }
    for (const [id, liste] of msgsByConv) {
      if (liste.length > MAX_PAR_FIL) msgsByConv.set(id, liste.slice(-MAX_PAR_FIL));
    }
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
