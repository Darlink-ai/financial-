import { NextResponse } from "next/server";
import { clearDriveOAuth } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await clearDriveOAuth();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "db_error", message: (e as Error).message },
      { status: 503 },
    );
  }
}
