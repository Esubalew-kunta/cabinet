import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import ws from "ws";

/** Client lié à la session de l'utilisateur (RLS active). */
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Node 20 : pas de WebSocket natif (realtime inutilisé mais requis au constructeur)
      realtime: { transport: ws as unknown as typeof WebSocket },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Component sans possibilité d'écrire les cookies — ok,
            // le proxy rafraîchit la session.
          }
        },
      },
    }
  );
}
