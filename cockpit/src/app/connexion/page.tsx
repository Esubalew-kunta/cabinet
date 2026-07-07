"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { LangToggle } from "@/components/lang-toggle";
import { useTr } from "@/components/i18n-provider";
import { Eye, EyeOff, HeartPulse } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { tr } = useTr();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [inactive] = useState(params.get("erreur") === "inactif");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label={tr.login.email}>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
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
            onChange={(e) => setPassword(e.target.value)}
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
  );
}

function LoginShell() {
  const { tr } = useTr();
  return (
    <main className="relative flex min-h-screen items-center justify-center p-4">
      <div className="absolute right-4 top-4">
        <LangToggle />
      </div>
      <div className="rise-in w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-accent-soft shadow-sm">
            <HeartPulse className="size-7 text-accent" />
          </div>
          <h1 className="font-display text-2xl font-semibold">{tr.login.title}</h1>
          <p className="mt-1 text-sm text-muted">{tr.login.subtitle}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-[0_4px_16px_rgba(16,24,40,0.06)]">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-4 text-center text-xs text-muted">{tr.login.noAccount}</p>
      </div>
    </main>
  );
}

export default function ConnexionPage() {
  return <LoginShell />;
}
