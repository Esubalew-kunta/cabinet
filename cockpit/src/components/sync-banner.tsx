"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { useTr } from "@/components/i18n-provider";
import type { SyncRun } from "@/lib/types";

export function SyncBanner({ lastRun }: { lastRun: SyncRun | null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ageMin, setAgeMin] = useState<number | null>(null);
  const router = useRouter();
  const { lang, tr } = useTr();

  const finishedAt = lastRun?.finished_at ?? null;
  useEffect(() => {
    const compute = () =>
      setAgeMin(finishedAt ? Math.round((Date.now() - new Date(finishedAt).getTime()) / 60000) : null);
    const kick = setTimeout(compute, 0);
    const timer = setInterval(compute, 60_000);
    return () => {
      clearTimeout(kick);
      clearInterval(timer);
    };
  }, [finishedAt]);

  async function syncNow() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const body = await res.json();
      if (!res.ok) setError(body.errors?.join(" | ") ?? body.error ?? tr.sync.failed);
      router.refresh();
    } catch {
      setError(tr.sync.unreachable);
    } finally {
      setLoading(false);
    }
  }

  const stale = ageMin === null || ageMin > 30 || lastRun?.status === "error";

  return (
    <div
      className={cn(
        "rise-in flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-3",
        stale ? "border-warning/40 bg-warning-soft" : "border-border bg-surface"
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        {stale ? (
          <AlertTriangle className="size-4 shrink-0 text-warning" />
        ) : (
          <CheckCircle2 className="size-4 shrink-0 text-success" />
        )}
        {lastRun ? (
          <span>
            {tr.sync.lastSync} <strong>{formatDate(lastRun.finished_at ?? lastRun.started_at, lang)}</strong>
            {ageMin !== null && <span className="text-muted"> ({tr.sync.ago(ageMin)})</span>}
            {lastRun.status === "error" && (
              <span className="ml-2 text-danger" title={lastRun.error ?? ""}>
                · {tr.sync.inError}
              </span>
            )}
          </span>
        ) : (
          <span>{tr.sync.never}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {error && <span className="text-xs text-danger">{error}</span>}
        <Button size="sm" variant="secondary" loading={loading} onClick={syncNow}>
          <RefreshCw className="size-3.5" /> {tr.sync.syncNow}
        </Button>
      </div>
    </div>
  );
}
