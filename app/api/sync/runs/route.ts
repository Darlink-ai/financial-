import { NextResponse } from "next/server";
import { getRecentSyncRuns } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const runs = await getRecentSyncRuns(10);
  return NextResponse.json({ runs });
}
