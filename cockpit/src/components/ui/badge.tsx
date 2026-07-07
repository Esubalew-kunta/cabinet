"use client";

import { cn, EMPTY } from "@/lib/utils";
import type { Tone } from "@/lib/labels";
import { tv } from "@/lib/i18n/dict";
import { useLang } from "@/components/i18n-provider";

const tones: Record<Tone, string> = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-info-soft text-info",
  green: "bg-success-soft text-success",
  yellow: "bg-warning-soft text-warning",
  orange: "bg-orange-100 text-orange-700",
  red: "bg-danger-soft text-danger",
  violet: "bg-violet-soft text-violet",
};

const dots: Record<Tone, string> = {
  gray: "bg-gray-400",
  blue: "bg-info",
  green: "bg-success",
  yellow: "bg-warning",
  orange: "bg-orange-500",
  red: "bg-danger",
  violet: "bg-violet",
};

export function Badge({
  tone = "gray",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * Badge de statut : la valeur métier reste française, l'affichage est traduit
 * (tv) selon la langue de l'interface.
 */
export function StatusBadge({
  value,
  map,
}: {
  value: string | null | undefined;
  map: Record<string, Tone>;
}) {
  const lang = useLang();
  if (!value) return <span className="text-xs text-muted">{EMPTY}</span>;
  const tone = map[value] ?? "gray";
  return (
    <Badge tone={tone}>
      <span className={cn("size-1.5 rounded-full", dots[tone])} />
      {tv(lang, value)}
    </Badge>
  );
}
