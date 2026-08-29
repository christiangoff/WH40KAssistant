import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { buildUnitStats, persistUnitStats } from "@/lib/unitStats";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const db = getDb();
    const unit = db
      .prepare("SELECT * FROM units WHERE id = ? AND user_id = ?")
      .get(id, user.id) as { id: number; wahapedia_url: string | null; name?: string } | undefined;

    if (!unit) return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    if (!unit.wahapedia_url) {
      return NextResponse.json({ error: "No Wahapedia URL set for this unit" }, { status: 400 });
    }

    const stats = await buildUnitStats(unit.wahapedia_url);
    persistUnitStats(db, unit.id, unit.name, stats);

    return NextResponse.json(db.prepare("SELECT * FROM units WHERE id = ?").get(id));
  } catch (error) {
    console.error("POST /api/units/[id]/fetch-stats error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
