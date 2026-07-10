import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { selectMFMTier, getPointsFromTier } from "@/lib/mfm";
import type { MFMPricingTier } from "@/lib/mfm";

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const armies = db
      .prepare("SELECT * FROM armies WHERE user_id = ? ORDER BY created_at DESC")
      .all(user.id) as Array<{
        id: number; name: string; faction: string | null;
        point_limit: number; created_at: number;
      }>;

    const armiesWithStats = armies.map((army) => {
      const units = db.prepare(`
        SELECT au.unit_id, au.model_count, au.custom_points, u.stats_json
        FROM army_units au JOIN units u ON u.id = au.unit_id
        WHERE au.army_id = ? ORDER BY au.id ASC
      `).all(army.id) as Array<{ unit_id: number; model_count: number; custom_points: number | null; stats_json: string | null }>;

      // Track how many of each unit_id we've seen to compute copy index (for MFM tier pricing)
      const copyCount: Record<number, number> = {};
      const totalPoints = units.reduce((sum, u) => {
        if (u.custom_points !== null) return sum + u.custom_points;
        const stats = u.stats_json ? JSON.parse(u.stats_json) : null;
        if (!stats) return sum;
        const copyIndex = copyCount[u.unit_id] ?? 0;
        copyCount[u.unit_id] = copyIndex + 1;
        if (Array.isArray(stats.mfm_tiers) && (stats.mfm_tiers as MFMPricingTier[]).length > 0) {
          const tier = selectMFMTier(stats.mfm_tiers as MFMPricingTier[], copyIndex);
          return sum + getPointsFromTier(tier, u.model_count);
        }
        const table = stats.points_table as Array<{ models: number; points: number }> | null;
        if (table && table.length > 0) {
          const sorted = [...table].sort((a, b) => a.models - b.models);
          const match = [...sorted].filter(e => e.models <= u.model_count);
          return sum + (match.length > 0 ? match[match.length - 1].points : sorted[0].points);
        }
        return sum + ((stats.points_per_model || 0) * u.model_count);
      }, 0);

      return { ...army, unit_count: units.length, total_points: totalPoints };
    });

    return NextResponse.json(armiesWithStats);
  } catch (error) {
    console.error("GET /api/armies error:", error);
    return NextResponse.json({ error: "Failed to fetch armies" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const body = await request.json();
    const { name, point_limit = 2000, faction = null } = body;

    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const result = db
      .prepare("INSERT INTO armies (name, point_limit, faction, user_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(name, point_limit, faction, user.id, Date.now());

    return NextResponse.json(db.prepare("SELECT * FROM armies WHERE id = ?").get(result.lastInsertRowid), { status: 201 });
  } catch (error) {
    console.error("POST /api/armies error:", error);
    return NextResponse.json({ error: "Failed to create army" }, { status: 500 });
  }
}
