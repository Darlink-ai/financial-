import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pour ne pas exposer le client_secret au navigateur, on renvoie juste un
// booléen `googleClientSecretSet`. Le client_id est OK à révéler.
export async function GET() {
  const [clientId, clientSecret] = await Promise.all([
    getSetting("google_client_id"),
    getSetting("google_client_secret"),
  ]);
  return NextResponse.json({
    googleClientId: clientId ?? "",
    googleClientSecretSet: !!clientSecret,
  });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as {
    googleClientId?: string;
    googleClientSecret?: string;
  };

  const tasks: Promise<unknown>[] = [];
  if (typeof body.googleClientId === "string") {
    tasks.push(setSetting("google_client_id", body.googleClientId.trim()));
  }
  if (typeof body.googleClientSecret === "string" && body.googleClientSecret) {
    tasks.push(setSetting("google_client_secret", body.googleClientSecret));
  }
  await Promise.all(tasks);
  return NextResponse.json({ ok: true });
}
