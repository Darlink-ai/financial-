"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isAllowedEmail } from "@/lib/supabase/env";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

/**
 * Login email + mot de passe.
 *
 * Le flow magic link / OTP a été retiré : SMTP Supabase saturé + rate limit
 * bloquaient les envois. Chaque email autorisé (ALLOWED_EMAILS dans
 * lib/supabase/env) a maintenant un mot de passe fixe partagé, provisionné
 * via /api/admin/set-passwords.
 */
function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");
  const nextPath = searchParams.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (errorParam === "domain_not_allowed") {
      setError("Accès refusé.");
    }
  }, [errorParam]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!isAllowedEmail(trimmed)) {
      setError("Accès refusé.");
      return;
    }
    if (!password) {
      setError("Mot de passe requis.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: sbError } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      });
      if (sbError) {
        setError(sbError.message);
        return;
      }
      router.push(nextPath);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <form onSubmit={signIn} className="space-y-3">
          <input
            type="email"
            autoFocus
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
            required
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            required
          />
          <button
            type="submit"
            disabled={loading || !email || !password}
            className="btn btn-primary w-full justify-center disabled:opacity-50"
          >
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </form>

        {error && (
          <div className="mt-3 text-[12px] text-err text-center">{error}</div>
        )}
      </div>
    </div>
  );
}
