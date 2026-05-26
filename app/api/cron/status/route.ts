import { NextResponse } from "next/server";
import { getSetting, setSetting, getRecentSyncRuns } from "@/lib/db";
import {
  CRON_SCHEDULE,
  CRON_SCHEDULE_LABEL,
  nextCronRun,
} from "@/lib/cron-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_ENABLED_KEY = "cron_enabled";

export async function GET() {
  const v = await getSetting(CRON_ENABLED_KEY);
  // default true tant que rien n'est posé
  const enabled = v !== "false";

  const runs = await getRecentSyncRuns(5);
  const lastCronRun = runs.find((r) => r.trigger === "cron") ?? null;
  const lastRun = runs[0] ?? null;

  return NextResponse.json({
    enabled,
    schedule: CRON_SCHEDULE,
    scheduleLabel: CRON_SCHEDULE_LABEL,
    nextRun: enabled ? nextCronRun().toISOString() : null,
    lastCronRun,
    lastRun,
  });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as { enabled?: boolean };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "missing_enabled" }, { status: 400 });
  }
  await setSetting(CRON_ENABLED_KEY, body.enabled ? "true" : "false");
  return NextResponse.json({ ok: true, enabled: body.enabled });
}
