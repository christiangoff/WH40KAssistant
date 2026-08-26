import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { computeArmyTotals } from "@/lib/armies";

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const armies = db.prepare(`
      SELECT a.*, u.username AS owner_username
      FROM armies a
      JOIN army_shares s ON s.army_id = a.id
      JOIN users u ON u.id = a.user_id
      WHERE s.shared_with = ?
      ORDER BY s.shared_at DESC
    `).all(user.id) as Array<{
      id: number; name: string; faction: string | null;
      point_limit: number; created_at: number; owner_username: string;
    }>;

    const armiesWithStats = armies.map((army) => ({ ...army, ...computeArmyTotals(db, army.id) }));

    return NextResponse.json(armiesWithStats);
  } catch (error) {
    console.error("GET /api/armies/shared error:", error);
    return NextResponse.json({ error: "Failed to fetch shared armies" }, { status: 500 });
  }
}
