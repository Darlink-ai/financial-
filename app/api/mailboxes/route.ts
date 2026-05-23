import { NextResponse } from "next/server";
import { createMailbox } from "@/lib/db";
import type { Mailbox } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as Mailbox;
  return NextResponse.json(await createMailbox(body));
}
