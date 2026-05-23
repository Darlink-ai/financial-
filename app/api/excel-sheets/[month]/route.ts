import { NextResponse } from "next/server";
import { getExcelSheet, saveExcelSheet, deleteExcelSheet } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-\d{2}$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ month: string }> },
) {
  const { month } = await params;
  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ error: "bad_month" }, { status: 400 });
  }
  try {
    const sheet = await getExcelSheet(month);
    return NextResponse.json({ sheet });
  } catch (e) {
    console.error("GET /api/excel-sheets/[month] failed", e);
    return NextResponse.json({ error: "db_error" }, { status: 503 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ month: string }> },
) {
  const { month } = await params;
  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ error: "bad_month" }, { status: 400 });
  }
  const body = (await req.json()) as {
    fileName: string;
    headers: string[];
    rows: (string | number | null)[][];
  };
  if (!body?.fileName || !Array.isArray(body.headers) || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  try {
    const saved = await saveExcelSheet({
      month,
      fileName: body.fileName,
      headers: body.headers,
      rows: body.rows,
    });
    return NextResponse.json({ sheet: saved });
  } catch (e) {
    console.error("PUT /api/excel-sheets/[month] failed", e);
    return NextResponse.json({ error: "db_error" }, { status: 503 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ month: string }> },
) {
  const { month } = await params;
  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ error: "bad_month" }, { status: 400 });
  }
  try {
    await deleteExcelSheet(month);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/excel-sheets/[month] failed", e);
    return NextResponse.json({ error: "db_error" }, { status: 503 });
  }
}
