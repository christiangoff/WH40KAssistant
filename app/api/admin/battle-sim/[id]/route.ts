import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

// Admin-only: one past battle's summary + full turn-by-turn log.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const battle = db
    .prepare(
      `SELECT sb.*, aa.name AS army_a_name, ab.name AS army_b_name
       FROM sim_battles sb
       JOIN armies aa ON aa.id = sb.army_a_id
       JOIN armies ab ON ab.id = sb.army_b_id
       WHERE sb.id = ?`
    )
    .get(id);
  if (!battle) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const log = db.prepare(`SELECT round, phase, message FROM sim_battle_log WHERE battle_id = ? ORDER BY seq ASC`).all(id);
  return NextResponse.json({ ...battle, log });
}
