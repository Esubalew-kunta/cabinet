/**
 * Activation des réservations d'appareils.
 *
 * Une réservation est un examen dont la « Date de pose » est à venir : l'unité reste
 * « Au cabinet » et disponible d'ici là (c'est tout l'intérêt — réserver ne doit pas
 * immobiliser pendant trois mois).
 *
 * Mais le jour de la pose, quelqu'un doit faire passer l'unité « Dehors », sinon le parc
 * afficherait « Au cabinet » alors que le boîtier est chez un patient. C'est le rôle de
 * cette fonction, rejouée par la sync (/api/sync, toutes les 2 h).
 *
 * À noter : la DISPONIBILITÉ ne dépend pas de ce passage. Elle se calcule sur les fenêtres
 * des examens (cf. appareils.ts), donc une activation en retard ne peut jamais provoquer
 * de double réservation — elle ne fait que rafraîchir l'état affiché.
 *
 * Idempotent : une unité déjà « Dehors » pour ce même examen est ignorée.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { P, notionUpdate } from "@/lib/notion/write";
import { jour } from "@/lib/appareils";

const BATCH = 50;

export async function activerReservationsDues(): Promise<{ actives: number }> {
  const admin = supabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  // Prêts ouverts dont la pose est atteinte : ce sont ceux qui doivent être « Dehors ».
  const { data: dus } = await admin
    .from("examens")
    .select("notion_id, appareil, date_pose, statut_appareil")
    .is("restitution_effective", null)
    .not("appareil", "is", null)
    .lte("date_pose", today + "T23:59:59")
    .limit(BATCH);

  if (!dus?.length) return { actives: 0 };

  let actives = 0;
  for (const ex of dus) {
    const uniteId = ex.appareil?.[0];
    if (!uniteId) continue;
    if ((jour(ex.date_pose) ?? today) > today) continue; // sécurité : pas encore due

    try {
      const { data: unite } = await admin
        .from("appareils")
        .select("etat, examen_en_cours")
        .eq("notion_id", uniteId)
        .maybeSingle();
      if (!unite) continue;

      // Déjà sortie pour cet examen : rien à faire (idempotence).
      if (unite.etat === "Dehors" && (unite.examen_en_cours ?? []).includes(ex.notion_id)) continue;
      // Hors service (Maintenance/Perdu/Réformé) : on ne force pas l'état, un humain tranchera.
      if (unite.etat && !["Au cabinet", "Dehors"].includes(unite.etat)) continue;
      // Déjà Dehors pour un AUTRE examen : le prêt précédent n'a pas été rendu.
      // On ne l'écrase pas — c'est justement le cas « retard qui bloque une réservation »,
      // signalé dans l'UI (cf. retardBloqueUneReservation).
      if (unite.etat === "Dehors") continue;

      await notionUpdate(uniteId, { "État": P.select("Dehors") });
      await admin.from("appareils").update({ etat: "Dehors", examen_en_cours: [ex.notion_id] }).eq("notion_id", uniteId);

      if (ex.statut_appareil !== "Remis") {
        await notionUpdate(ex.notion_id, { "Statut appareil": P.select("Remis") });
        await admin.from("examens").update({ statut_appareil: "Remis" }).eq("notion_id", ex.notion_id);
      }
      actives++;
    } catch {
      // best-effort : une unité en échec ne bloque pas les autres ni la sync
    }
  }

  return { actives };
}
