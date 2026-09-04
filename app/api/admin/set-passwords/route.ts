import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ALLOWED_EMAILS, getSupabaseEnv } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/admin/set-passwords
 * Body: { password: string }
 * Auth: Bearer CRON_SECRET
 *
 * Provisionne (ou met à jour) chaque email de ALLOWED_EMAILS dans Supabase
 * Auth avec le mot de passe fourni. Utilise le SERVICE_ROLE_KEY côté serveur
 * (jamais exposé au client) pour l'API Admin.
 *
 * Comportement :
 *   - Email existe → on update son password + email_confirmed_at si besoin
 *   - Email n'existe pas → on crée l'user avec email_confirm=true (auto-confirmé)
 *
 * A appeler UNE FOIS (ou à chaque changement de mot de passe partagé).
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!body.password || body.password.length < 8) {
    return NextResponse.json(
      { error: "bad_password", message: "password (>= 8 chars) requis dans le body." },
      { status: 400 },
    );
  }

  const env = getSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env || !serviceKey) {
    return NextResponse.json(
      { error: "missing_env", message: "SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis." },
      { status: 500 },
    );
  }

  const admin = createClient(env.url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results: Array<{
    email: string;
    action: "created" | "updated" | "error";
    message?: string;
  }> = [];

  for (const email of ALLOWED_EMAILS) {
    try {
      // Cherche l'user existant par email. listUsers ne filtre pas par
      // email — on paginate et on filtre côté client (petit user pool).
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (listErr) throw listErr;
      const existing = list?.users.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase(),
      );

      if (existing) {
        const { error: updErr } = await admin.auth.admin.updateUserById(
          existing.id,
          {
            password: body.password,
            email_confirm: true,
          },
        );
        if (updErr) throw updErr;
        results.push({ email, action: "updated" });
      } else {
        const { error: createErr } = await admin.auth.admin.createUser({
          email,
          password: body.password,
          email_confirm: true,
        });
        if (createErr) throw createErr;
        results.push({ email, action: "created" });
      }
    } catch (e) {
      results.push({
        email,
        action: "error",
        message: (e as Error).message,
      });
    }
  }

  return NextResponse.json({ ok: true, results });
}
