"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { ALLOWED_EMAIL_DOMAINS, isAllowedEmail } from "@/lib/supabase/env";
import { Mail, Lock, ArrowRight, Activity, AlertCircle, CheckCircle2 } from "lucide-react";

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
  const nextPath = searchParams.get("next") ?? "/";

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (errorParam === "domain_not_allowed") {
      setError(
        `Accès réservé aux comptes ${ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(", ")}.`,
      );
    }
  }, [errorParam]);

  const sendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const trimmed = email.trim().toLowerCase();
    if (!isAllowedEmail(trimmed)) {
      setError(
        `Email refusé : seuls les comptes ${ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(", ")} sont autorisés.`,
      );
      return;
    }
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: sbError } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          shouldCreateUser: true,
        },
      });
      if (sbError) {
        setError(sbError.message);
        return;
      }
      setEmail(trimmed);
      setStep("otp");
      setInfo("Code envoyé. Vérifie ta boîte mail (et tes spams).");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const code = otp.replace(/\s/g, "").trim();
    if (code.length < 6) {
      setError("Le code doit contenir 6 chiffres.");
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const resetToEmail = () => {
    setStep("email");
    setOtp("");
    setError(null);
    setInfo(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-accent2 flex items-center justify-center">
            <Activity size={18} className="text-white" />
          </div>
          <div>
            <div className="text-[17px] font-semibold leading-tight">Factura</div>
            <div className="text-[12px] text-muted leading-tight">Connexion</div>
          </div>
        </div>

        <div className="card p-7">
          {step === "email" ? (
            <form onSubmit={sendOtp} className="space-y-4">
              <div>
                <div className="text-[15px] font-semibold mb-1">Identifie-toi</div>
                <div className="text-[12px] text-muted">
                  Un code à 6 chiffres te sera envoyé par email. Accès réservé aux comptes{" "}
                  <code className="font-mono text-text">
                    @{ALLOWED_EMAIL_DOMAINS.join(" / @")}
                  </code>
                  .
                </div>
              </div>

              <div>
                <label className="text-[11px] text-muted block mb-1.5">Email</label>
                <div className="relative">
                  <Mail
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                  />
                  <input
                    type="email"
                    autoFocus
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="prenom.nom@famelink.ai"
                    className="input pl-9"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !email}
                className="btn btn-primary w-full justify-center disabled:opacity-50"
              >
                {loading ? "Envoi…" : "Recevoir le code"}
                <ArrowRight size={14} />
              </button>
            </form>
          ) : (
            <form onSubmit={verifyOtp} className="space-y-4">
              <div>
                <div className="text-[15px] font-semibold mb-1">Vérification</div>
                <div className="text-[12px] text-muted">
                  Tape le code à 6 chiffres reçu sur{" "}
                  <span className="text-text font-medium">{email}</span>.
                </div>
              </div>

              <div>
                <label className="text-[11px] text-muted block mb-1.5">Code OTP</label>
                <div className="relative">
                  <Lock
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    autoFocus
                    autoComplete="one-time-code"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder="123456"
                    className="input pl-9 font-mono tracking-[0.4em] text-center text-[16px]"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || otp.length < 6}
                className="btn btn-primary w-full justify-center disabled:opacity-50"
              >
                {loading ? "Vérification…" : "Se connecter"}
                <ArrowRight size={14} />
              </button>

              <button
                type="button"
                onClick={resetToEmail}
                className="text-[12px] text-muted hover:text-text w-full text-center"
              >
                ← Changer d'email
              </button>
            </form>
          )}

          {error && (
            <div className="mt-4 card border-err/40 bg-err/5 p-3 flex items-start gap-2 text-[12px] text-err">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <div className="leading-relaxed">{error}</div>
            </div>
          )}
          {info && (
            <div className="mt-4 card border-ok/40 bg-ok/5 p-3 flex items-start gap-2 text-[12px] text-ok">
              <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
              <div className="leading-relaxed">{info}</div>
            </div>
          )}
        </div>

        <div className="text-[11px] text-muted text-center mt-5">
          Pas de compte ? L'inscription se fait automatiquement lors de la première connexion (si
          ton email est autorisé).
        </div>
      </div>
    </div>
  );
}
