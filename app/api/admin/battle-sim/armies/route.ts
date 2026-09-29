import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

// Admin-only: every army in the system (not just the admin's own), with
// owner + rough size, for the battle simulator's two army pickers.
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const armies = db
    .prepare(
      `SELECT a.id, a.name, a.faction, a.point_limit, u.username AS owner_username,
              (SELECT COUNT(*) FROM army_units au WHERE au.army_id = a.id) AS unit_count
       FROM armies a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY u.username ASC, a.name ASC`
    )
    .all();

  return NextResponse.json(armies);
}
