"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isAllowedEmail } from "@/lib/supabase/env";

type Step = "email" | "otp";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");
  const codeParam = searchParams.get("code");
  const nextPath = searchParams.get("next") ?? "/";

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (errorParam === "domain_not_allowed") {
      setError("Accès refusé.");
    }
  }, [errorParam]);

  // Si on arrive via le lien magique (?code=...), on échange le code
  // contre une session puis on redirige.
  useEffect(() => {
    if (!codeParam) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const supabase = createSupabaseBrowserClient();
        const { error: sbError } =
          await supabase.auth.exchangeCodeForSession(codeParam);
        if (cancelled) return;
        if (sbError) {
          setError(
            "Lien expiré ou invalide. Recommence avec un email et saisis le code à 6 chiffres.",
          );
          // Nettoie le ?code pour ne pas re-tenter en boucle.
          router.replace("/login");
          return;
        }
        router.push(nextPath);
        router.refresh();
      } catch {
        if (!cancelled) {
          setError(
            "Lien expiré ou invalide. Recommence avec un email et saisis le code à 6 chiffres.",
          );
          router.replace("/login");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [codeParam, router, nextPath]);

  const sendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!isAllowedEmail(trimmed)) {
      setError("Accès refusé.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: sbError } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { shouldCreateUser: true },
      });
      if (sbError) {
        setError(sbError.message);
        return;
      }
      setEmail(trimmed);
      setStep("otp");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const code = otp.replace(/\s/g, "").trim();
    if (code.length < 6 || code.length > 10) {
      setError("Code attendu : 6 à 10 chiffres.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: sbError } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "email",
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
        {step === "email" ? (
          <form onSubmit={sendOtp} className="space-y-3">
            <input
              type="email"
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              required
            />
            <button
              type="submit"
              disabled={loading || !email}
              className="btn btn-primary w-full justify-center disabled:opacity-50"
            >
              {loading ? "Envoi…" : "Suivant"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="space-y-3">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6,10}"
              maxLength={10}
              autoFocus
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/[^\d]/g, ""))}
              className="input font-mono tracking-[0.3em] text-center text-[16px]"
              required
            />
            <button
              type="submit"
              disabled={loading || otp.length < 6}
              className="btn btn-primary w-full justify-center disabled:opacity-50"
            >
              {loading ? "Vérification…" : "Suivant"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setOtp("");
                setError(null);
              }}
              className="text-[11px] text-muted hover:text-text w-full text-center"
            >
              ← Changer d'email
            </button>
          </form>
        )}

        {error && (
          <div className="mt-3 text-[12px] text-err text-center">{error}</div>
        )}
      </div>
    </div>
  );
}
