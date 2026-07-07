"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { LangToggle } from "@/components/lang-toggle";
import { useTr } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import { ClipboardList, Eye, EyeOff, HeartPulse, Settings2, Stethoscope } from "lucide-react";

type DemoAccount = {
  key: "admin" | "doctor" | "secretary";
  email: string;
  password: string;
  icon: React.ReactNode;
  tone: string;
};

const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    key: "admin",
    email: "admin@cabinet-amraoui.fr",
    password: "Admin-Cabinet-2026!",
    icon: <Settings2 className="size-4" />,
    tone: "bg-violet-soft text-violet",
  },
  {
    key: "doctor",
    email: "dr.zouheir@cabinet-amraoui.fr",
    password: "Dr-Zouheir-2026!",
    icon: <Stethoscope className="size-4" />,
    tone: "bg-info-soft text-info",
  },
  {
    key: "secretary",
    email: "secretariat@cabinet-amraoui.fr",
    password: "Secretariat-2026!",
    icon: <ClipboardList className="size-4" />,
    tone: "bg-success-soft text-success",
  },
];

function LoginPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const { tr } = useTr();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [activeDemo, setActiveDemo] = useState<string | null>(null);
  const [inactive] = useState(params.get("erreur") === "inactif");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const roleLabel: Record<DemoAccount["key"], string> = {
    admin: tr.login.roleAdmin,
    doctor: tr.login.roleDoctor,
    secretary: tr.login.roleSecretary,
  };

  function fillDemo(acc: DemoAccount) {
    setEmail(acc.email);
    setPassword(acc.password);
    setActiveDemo(acc.key);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supa = supabaseBrowser();
    const { error } = await supa.auth.signInWithPassword({ email, password });
    if (error) {
      setError(tr.login.badCredentials);
      setLoading(false);
      return;
    }
    router.replace(params.get("suivant") || "/");
    router.refresh();
  }

  const message = error ?? (inactive && !loading ? tr.login.inactive : null);

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-stretch">
      {/* Sélecteur de comptes démo */}
      <div className="order-2 w-full rounded-2xl border border-border bg-surface/70 p-4 shadow-sm md:order-1 md:w-60">
        <p className="text-sm font-semibold">{tr.login.demoTitle}</p>
        <p className="mt-0.5 text-xs text-muted">{tr.login.demoHint}</p>
        <div className="mt-3 flex flex-col gap-2">
          {DEMO_ACCOUNTS.map((acc) => (
            <button
              key={acc.key}
              type="button"
              onClick={() => fillDemo(acc)}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all hover:shadow-sm active:scale-[0.98]",
                activeDemo === acc.key ? "border-primary bg-primary-soft/40" : "border-border bg-surface hover:border-ring/60"
              )}
            >
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", acc.tone)}>
                {acc.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{roleLabel[acc.key]}</span>
                <span className="block truncate text-xs text-muted">{acc.email}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Formulaire */}
      <div className="order-1 w-full rounded-2xl border border-border bg-surface p-6 shadow-[0_4px_16px_rgba(16,24,40,0.06)] md:order-2 md:w-80">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label={tr.login.email}>
            <Input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setActiveDemo(null); }}
              placeholder="vous@cabinet.fr"
              autoComplete="email"
              required
            />
          </Field>
          <Field label={tr.login.password}>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setActiveDemo(null); }}
                placeholder="••••••••"
                autoComplete="current-password"
                className="pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          {message && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{message}</p>}
          <Button type="submit" className="w-full" loading={loading}>
            {tr.login.submit}
          </Button>
        </form>
      </div>
    </div>
  );
}

function LoginShell() {
  const { tr } = useTr();
  return (
    <main className="relative flex min-h-screen items-center justify-center p-4">
      <div className="absolute right-4 top-4">
        <LangToggle />
      </div>
      <div className="rise-in w-full max-w-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-accent-soft shadow-sm">
            <HeartPulse className="size-7 text-accent" />
          </div>
          <h1 className="font-display text-2xl font-semibold">{tr.login.title}</h1>
          <p className="mt-1 text-sm text-muted">{tr.login.subtitle}</p>
        </div>
        <Suspense>
          <LoginPanel />
        </Suspense>
        <p className="mt-4 text-center text-xs text-muted">{tr.login.noAccount}</p>
      </div>
    </main>
  );
}

export default function ConnexionPage() {
  return <LoginShell />;
}
