import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const factionId = request.nextUrl.searchParams.get("faction_id");
  if (!factionId) return NextResponse.json({ error: "faction_id is required" }, { status: 400 });

  const db = getDb();
  const detachments = db
    .prepare("SELECT * FROM detachments WHERE faction_id = ? ORDER BY dp_cost DESC, name ASC")
    .all(factionId) as { id: number }[];

  const enhancementsStmt = db.prepare("SELECT * FROM enhancements WHERE detachment_id = ? ORDER BY points ASC");
  const stratagemCountStmt = db.prepare("SELECT COUNT(*) as n FROM stratagems WHERE detachment_id = ?");

  const withDetails = detachments.map((d) => ({
    ...d,
    enhancements: enhancementsStmt.all(d.id),
    stratagem_count: (stratagemCountStmt.get(d.id) as { n: number }).n,
  }));

  return NextResponse.json(withDetails);
}
