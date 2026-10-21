import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { refreshUnitDatasheet } from "@/lib/unitStats";
import { ensureCatalog } from "@/lib/catalog";

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

    await ensureCatalog(db).catch(() => {}); // resolution degrades to "unknown" without it
    const resolution = await refreshUnitDatasheet(db, { id: unit.id, name: unit.name, wahapedia_url: unit.wahapedia_url });
    // Same datasheet_status field GET /api/units adds; just re-scraped, so never "outdated".
    const datasheet_status =
      resolution.status === "retired" ? "retired" : resolution.status === "current" ? "current" : null;

    return NextResponse.json({
      ...(db.prepare("SELECT * FROM units WHERE id = ?").get(id) as object),
      datasheet_status,
    });
  } catch (error) {
    console.error("POST /api/units/[id]/fetch-stats error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
