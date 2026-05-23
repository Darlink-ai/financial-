import { NextResponse } from "next/server";
import { createBusiness } from "@/lib/db";
import type { Business } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as Business;
  return NextResponse.json(await createBusiness(body));
}
