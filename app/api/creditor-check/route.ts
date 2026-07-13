import { NextResponse } from "next/server";
import { checkCreditorMatch } from "@/lib/llm-creditor-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * POST /api/creditor-check
 * Body : { invoiceCreditor: string, bankVendor: string }
 *
 * Vérifie via Claude Haiku si les 2 noms désignent la MÊME entité
 * commerciale (Brevo/Sendinblue, Meta/Facebook, filiales, rebrands…).
 *
 * Cache in-process → un même couple appelé plusieurs fois de suite dans
 * la session serveur ne recall pas l'API.
 *
 * Auth : hérite du middleware (session Supabase requise).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      invoiceCreditor?: string;
      bankVendor?: string;
    };
    const invoiceCreditor = (body.invoiceCreditor ?? "").trim();
    const bankVendor = (body.bankVendor ?? "").trim();
    if (!invoiceCreditor || !bankVendor) {
      return NextResponse.json(
        { error: "missing_params", message: "invoiceCreditor + bankVendor requis." },
        { status: 400 },
      );
    }
    const result = await checkCreditorMatch(invoiceCreditor, bankVendor);
    if (!result) {
      return NextResponse.json({
        ok: false,
        message: "LLM non configuré (ANTHROPIC_API_KEY manquante).",
      });
    }
    return NextResponse.json({
      ok: true,
      same: result.same,
      reason: result.reason,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "creditor_check_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
