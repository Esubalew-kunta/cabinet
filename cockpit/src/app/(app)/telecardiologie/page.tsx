import { redirect } from "next/navigation";
import { getSession, can, homeFor } from "@/lib/auth";
import { getTr } from "@/lib/i18n/server";
import { getTelecardioData } from "@/lib/telecardio-data";
import { cellKey } from "@/lib/telecardio";
import { TelecardioBoard } from "./interactive";

/**
 * Télécardiologie — le tableau de facturation de la télésurveillance.
 * Une ligne par patient porteur, une colonne par mois ; la secrétaire coche
 * Oui / Non / vide. Données Supabase, amorcées depuis l'Excel puis vécues ici.
 */
export default async function TelecardiologiePage() {
  const session = await getSession();
  if (!can(session, "telecardiologie")) redirect(homeFor(session.member));
  const { lang } = await getTr();

  const { patients, months, statutMap } = await getTelecardioData();

  // La Map ne traverse pas la frontière serveur→client : on l'aplatit en objet
  // simple (seules les cases Oui/Non existent ; « vide » = clé absente).
  const cells: Record<string, boolean> = {};
  for (const p of patients) {
    for (const m of months) {
      const v = statutMap.get(cellKey(p.id, m));
      if (v === true || v === false) cells[cellKey(p.id, m)] = v;
    }
  }

  return <TelecardioBoard lang={lang} patients={patients} months={months} initialCells={cells} />;
}
