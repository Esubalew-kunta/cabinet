import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Session } from "@/lib/auth";

/**
 * Journal d'audit : qui a fait quoi. Best-effort — ne casse JAMAIS l'action
 * métier si l'insertion échoue (on avale l'erreur). Écrit via le service role.
 */
export type AuditAction =
  | "create" | "update" | "delete"
  | "verify" | "assign" | "return" | "collect" | "penalty"
  | "stock_move" | "interpret" | "send" | "status" | "setting";

export async function logAudit(
  session: Session,
  entry: {
    action: AuditAction;
    area: string;
    targetId?: string | null;
    targetLabel?: string | null;
    detail?: Record<string, unknown> | null;
  }
): Promise<void> {
  try {
    await supabaseAdmin().from("audit_log").insert({
      member_id: session.member.id,
      actor_email: session.member.email,
      actor_nom: session.member.nom,
      action: entry.action,
      area: entry.area,
      target_id: entry.targetId ?? null,
      target_label: entry.targetLabel ?? null,
      detail: entry.detail ?? null,
    });
  } catch {
    /* accountability must never block the operation */
  }
}
