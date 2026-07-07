import { cookies } from "next/headers";
import { LANG_COOKIE, getDict, type Lang } from "./dict";

/** Langue de l'interface (cookie `lang`, défaut fr). Serveur uniquement. */
export async function getLang(): Promise<Lang> {
  const store = await cookies();
  return store.get(LANG_COOKIE)?.value === "en" ? "en" : "fr";
}

export async function getTr() {
  const lang = await getLang();
  return { lang, tr: getDict(lang) };
}
