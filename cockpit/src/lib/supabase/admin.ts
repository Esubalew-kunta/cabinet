import { createClient } from "@supabase/supabase-js";
import ws from "ws";

/**
 * Client service-role — contourne la RLS. À n'utiliser QUE côté serveur
 * (routes API / server actions), jamais exposé au navigateur.
 * transport ws : Node 20 n'a pas de WebSocket natif (realtime inutilisé mais
 * le constructeur l'exige).
 */
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: ws as unknown as typeof WebSocket },
    }
  );
}
