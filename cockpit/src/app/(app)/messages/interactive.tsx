"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Send } from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/toast";
import { useTr } from "@/components/i18n-provider";
import { cn, formatDate } from "@/lib/utils";
import { envoyerMessage, marquerConversationLue } from "@/lib/actions";
import type { Conversation, Message } from "@/lib/types";

type Lang = "fr" | "en";

export type Fil = {
  conversation: Conversation;
  nom: string;
  messages: Message[];
  nonLu: boolean;
};

/**
 * Boîte de réception (admin) ou conversation unique (membre).
 * Pas de temps réel : router.refresh() après envoi, comme le reste de l'app.
 */
export function MessagerieBoard({
  lang,
  isAdmin,
  fils,
  moiMemberId,
}: {
  lang: Lang;
  isAdmin: boolean;
  fils: Fil[];
  moiMemberId: string;
}) {
  const dict = useTr().tr.messages;
  const [selection, setSelection] = useState<string | null>(fils[0]?.conversation.id ?? null);

  // Le membre n'a qu'un fil : pas de liste, on affiche directement la conversation.
  if (!isAdmin) {
    const fil = fils[0] ?? null;
    return <FilConversation lang={lang} dict={dict} fil={fil} moiMemberId={moiMemberId} isAdmin={false} />;
  }

  const actif = fils.find((f) => f.conversation.id === selection) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="h-fit">
        <CardHeader icon={<MessageSquare />} title={dict.inboxTitle} />
        {fils.length === 0 ? (
          <CardBody>
            <span className="text-sm text-muted">{dict.inboxEmpty}</span>
          </CardBody>
        ) : (
          <div className="divide-y divide-border">
            {fils.map((f) => {
              const dernier = f.messages.at(-1);
              return (
                <button
                  key={f.conversation.id}
                  onClick={() => setSelection(f.conversation.id)}
                  className={cn(
                    "flex w-full cursor-pointer flex-col gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-primary-soft/40",
                    selection === f.conversation.id && "bg-primary-soft"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn("flex-1 truncate text-sm", f.nonLu && "font-semibold")}>{f.nom}</span>
                    {f.nonLu && <Badge tone="blue">{dict.newBadge}</Badge>}
                  </span>
                  <span className="truncate text-xs text-muted">{dernier?.corps ?? dict.noMessage}</span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <FilConversation lang={lang} dict={dict} fil={actif} moiMemberId={moiMemberId} isAdmin />
    </div>
  );
}

type Dict = ReturnType<typeof useTr>["tr"]["messages"];

function FilConversation({
  lang,
  dict,
  fil,
  moiMemberId,
  isAdmin,
}: {
  lang: Lang;
  dict: Dict;
  fil: Fil | null;
  moiMemberId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [corps, setCorps] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ouvrir un fil non lu le marque lu (fait tomber la pastille).
  // Dans un effet, pas pendant le rendu : un rendu doit rester pur.
  const convId = fil?.conversation.id ?? null;
  const nonLu = fil?.nonLu ?? false;
  useEffect(() => {
    if (!convId || !nonLu) return;
    let annule = false;
    void marquerConversationLue(convId).then(() => {
      if (!annule) router.refresh();
    });
    return () => {
      annule = true;
    };
  }, [convId, nonLu, router]);

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    const texte = corps.trim();
    if (!texte) return;
    setPending(true);
    setError(null);
    // Une seule action fait tout : Next 16 sérialise les server actions d'un client,
    // les enchaîner en parallèle ne gagnerait rien.
    const res = await envoyerMessage({
      corps: texte,
      destinataire: isAdmin ? fil?.conversation.personnel_notion_id ?? null : null,
    });
    setPending(false);
    if (res.ok) {
      setCorps("");
      toast(dict.sent);
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  if (isAdmin && !fil) {
    return (
      <Card>
        <CardBody>
          <span className="text-sm text-muted">{dict.pickThread}</span>
        </CardBody>
      </Card>
    );
  }

  const messages = fil?.messages ?? [];

  return (
    <Card>
      <CardHeader icon={<MessageSquare />} title={isAdmin ? fil?.nom ?? "" : dict.myThreadTitle} subtitle={isAdmin ? undefined : dict.myThreadSub} />
      <div className="max-h-[50vh] space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-muted">{dict.startHint}</p>
        ) : (
          messages.map((m) => {
            const moi = m.auteur_member_id === moiMemberId;
            return (
              <div key={m.id} className={cn("flex", moi ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[75%] rounded-xl px-3 py-2 text-sm",
                    moi ? "bg-primary-soft text-primary" : "border border-border bg-surface"
                  )}
                >
                  <div className="whitespace-pre-wrap break-words">{m.corps}</div>
                  <div className="mt-1 text-[10px] text-muted">
                    {m.est_admin ? dict.fromAdmin : dict.fromMember} · {formatDate(m.created_at, lang)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <form onSubmit={envoyer} className="space-y-2 border-t border-border p-4">
        <textarea
          value={corps}
          onChange={(e) => setCorps(e.target.value)}
          placeholder={dict.placeholder}
          rows={3}
          className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" loading={pending} disabled={!corps.trim()}>
            <Send className="size-3.5" /> {dict.send}
          </Button>
        </div>
      </form>
    </Card>
  );
}
