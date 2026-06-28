import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { scrapeWahapediaUnit } from "@/lib/wahapedia";
import { findMFMUnitPoints } from "@/lib/mfm";
import { getUserFromRequest } from "@/lib/auth";

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

    const stats = await scrapeWahapediaUnit(unit.wahapedia_url);

    // Fetch MFM points in parallel with a best-effort (don't fail if MFM is down)
    try {
      const mfmData = await findMFMUnitPoints(stats.name, stats.faction);
      if (mfmData && mfmData.tiers.length > 0) {
        stats.mfm_tiers = mfmData.tiers;
        // Override points_table / points_per_model with MFM data (first/cheapest tier)
        const primaryTier =
          mfmData.tiers.find((t) => t.copies === "1st-2nd" || t.copies === "all") ??
          mfmData.tiers[0];
        if (primaryTier.entries.length > 0) {
          stats.points_table = primaryTier.entries;
          const sorted = [...primaryTier.entries].sort((a, b) => a.models - b.models);
          stats.points_per_model = Math.round(sorted[0].points / sorted[0].models);
        }
      }
    } catch {
      // MFM fetch failure is non-fatal
    }

    db.prepare(
      "UPDATE units SET stats_json = ?, stats_fetched_at = ?, name = ?, faction = ? WHERE id = ?"
    ).run(JSON.stringify(stats), Date.now(), stats.name || unit.name || "Unknown", stats.faction ?? null, id);

    return NextResponse.json(db.prepare("SELECT * FROM units WHERE id = ?").get(id));
  } catch (error) {
    console.error("POST /api/units/[id]/fetch-stats error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
