import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const business = (searchParams.get("business") ?? "link").toLowerCase();

  const data: (string | number)[][] =
    business === "ify"
      ? [
          ["Pays", "Revenu"],
          ["CH", 6400],
          ["FR", 5100],
          ["DE", 4700],
          ["BE", 2200],
          ["US", 3900],
        ]
      : [
          ["Pays", "Revenu"],
          ["CH", 18200],
          ["FR", 12400],
          ["DE", 9800],
          ["IT", 3900],
          ["US", 4200],
        ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pays");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="exemple-pays-${business}.xlsx"`,
    },
  });
}
