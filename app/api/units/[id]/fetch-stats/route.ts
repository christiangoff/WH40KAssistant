import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { scrapeWahapediaUnit } from "@/lib/wahapedia";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const unit = db.prepare("SELECT * FROM units WHERE id = ?").get(id) as {
      id: number;
      wahapedia_url: string | null;
    } | undefined;

    if (!unit) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    if (!unit.wahapedia_url) {
      return NextResponse.json(
        { error: "No Wahapedia URL set for this unit" },
        { status: 400 }
      );
    }

    const stats = await scrapeWahapediaUnit(unit.wahapedia_url);

    db.prepare(`
      UPDATE units
      SET stats_json = ?, stats_fetched_at = ?, name = ?, faction = ?
      WHERE id = ?
    `).run(
      JSON.stringify(stats),
      Date.now(),
      stats.name || (unit as { name?: string }).name || "Unknown",
      stats.faction || null,
      id
    );

    const updated = db.prepare("SELECT * FROM units WHERE id = ?").get(id);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("POST /api/units/[id]/fetch-stats error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
