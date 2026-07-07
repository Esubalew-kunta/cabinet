"use client";

import { createContext, useContext } from "react";
import { getDict, type Lang } from "@/lib/i18n/dict";

const LangContext = createContext<Lang>("fr");

export function I18nProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

export function useTr() {
  const lang = useLang();
  return { lang, tr: getDict(lang) };
}
