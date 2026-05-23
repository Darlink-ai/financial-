import { NextResponse } from "next/server";
import { resetDatabase, getAllState, dbInfo } from "@/lib/db";

export const runtime = "nodejs";

export async function POST() {
  await resetDatabase();
  const state = await getAllState();
  const info = await dbInfo();
  return NextResponse.json({ ...state, _info: info });
}
