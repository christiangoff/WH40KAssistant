import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; unitId: string }> }
) {
  try {
    const { id, unitId } = await params;
    const db = getDb();
    const body = await request.json();
    const { current_wounds, is_destroyed } = body;

    const existing = db.prepare(
      "SELECT * FROM match_units WHERE id = ? AND match_id = ?"
    ).get(unitId, id);

    if (!existing) {
      return NextResponse.json({ error: "Match unit not found" }, { status: 404 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (current_wounds !== undefined) {
      updates.push("current_wounds = ?");
      values.push(Math.max(0, current_wounds));
    }
    if (is_destroyed !== undefined) {
      updates.push("is_destroyed = ?");
      values.push(is_destroyed ? 1 : 0);
    }

    if (updates.length > 0) {
      values.push(unitId);
      db.prepare(`UPDATE match_units SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    }

    const unit = db.prepare("SELECT * FROM match_units WHERE id = ?").get(unitId);
    return NextResponse.json(unit);
  } catch (error) {
    console.error("PUT /api/matches/[id]/units/[unitId] error:", error);
    return NextResponse.json({ error: "Failed to update match unit" }, { status: 500 });
  }
}
