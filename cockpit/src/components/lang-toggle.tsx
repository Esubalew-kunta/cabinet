"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";
import { LANG_COOKIE, type Lang } from "@/lib/i18n/dict";
import { useLang } from "@/components/i18n-provider";

function persistLang(next: Lang) {
  document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
}

/** Bascule FR / EN : cookie + refresh (les server components relisent la langue). */
export function LangToggle({ className }: { className?: string }) {
  const lang = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();

  function setLang(next: Lang) {
    if (next === lang) return;
    persistLang(next);
    start(() => router.refresh());
  }

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-surface p-0.5 text-[11px] font-semibold",
        pending && "opacity-60",
        className
      )}
      role="group"
      aria-label="Language"
    >
      {(["fr", "en"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          disabled={pending}
          className={cn(
            "cursor-pointer rounded-full px-2.5 py-1 uppercase tracking-wide transition-colors",
            lang === l ? "bg-primary text-white shadow-sm" : "text-muted hover:text-foreground"
          )}
          aria-pressed={lang === l}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
