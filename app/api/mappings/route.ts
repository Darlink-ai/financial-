import { NextResponse } from "next/server";
import { createMapping } from "@/lib/db";
import type { FolderMapping } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as FolderMapping;
  return NextResponse.json(await createMapping(body));
}
