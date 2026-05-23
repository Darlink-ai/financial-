import { NextResponse } from "next/server";
import { updateDrive } from "@/lib/db";
import type { DriveConfig } from "@/lib/types";

export const runtime = "nodejs";

export async function PATCH(req: Request) {
  const body = (await req.json()) as Partial<DriveConfig>;
  return NextResponse.json(await updateDrive(body));
}
