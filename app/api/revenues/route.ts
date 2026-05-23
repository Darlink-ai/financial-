import { NextResponse } from "next/server";
import { createRevenue } from "@/lib/db";
import type { Revenue } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as Revenue;
  const created = await createRevenue(body);
  return NextResponse.json(created);
}
