import { NextResponse } from "next/server";
import { getDriveOAuthState, setDriveCredentials } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getDriveOAuthState();
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json(
      { error: "db_error", message: (e as Error).message },
      { status: 503 },
    );
  }
}

export async function PUT(req: Request) {
  const body = (await req.json()) as { clientId?: string; clientSecret?: string };
  if (!body.clientId || !body.clientSecret) {
    return NextResponse.json({ error: "missing_credentials" }, { status: 400 });
  }
  try {
    await setDriveCredentials({
      clientId: body.clientId.trim(),
      clientSecret: body.clientSecret.trim(),
    });
    const state = await getDriveOAuthState();
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json(
      { error: "db_error", message: (e as Error).message },
      { status: 503 },
    );
  }
}
