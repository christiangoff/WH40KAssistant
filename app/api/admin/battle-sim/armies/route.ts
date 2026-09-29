import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

// Admin-only page, but the armies offered are the current user's own only —
// you play with armies you built, not someone else's.
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const armies = db
    .prepare(
      `SELECT a.id, a.name, a.faction, a.point_limit,
              (SELECT COUNT(*) FROM army_units au WHERE au.army_id = a.id) AS unit_count
       FROM armies a
       WHERE a.user_id = ?
       ORDER BY a.name ASC`
    )
    .all(user.id);

  return NextResponse.json(armies);
}
