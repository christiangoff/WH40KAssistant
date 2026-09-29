import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { advanceLiveBattle, type LiveBattleState } from "@/lib/battleSimLive";

// Admin-only: submit the player's decisions for whatever step the battle is
// currently paused on, then keep auto-advancing (opponent's turn, automatic
// phases) until the next decision point or the battle ends.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const row = db
    .prepare(`SELECT state_json, log_json, status FROM sim_live_battles WHERE id = ? AND user_id = ?`)
    .get(id, user.id) as { state_json: string; log_json: string; status: string } | undefined;
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status === "complete") return NextResponse.json({ error: "This battle is already over" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const decisions: Record<string, string> =
    body.decisions && typeof body.decisions === "object" ? body.decisions : {};

  const state: LiveBattleState = JSON.parse(row.state_json);
  const priorLog = JSON.parse(row.log_json);

  try {
    const { state: next, log: newEntries, pending } = advanceLiveBattle(state, decisions);
    const fullLog = [...priorLog, ...newEntries];

    db.prepare(
      `UPDATE sim_live_battles SET state_json = ?, log_json = ?, status = ?, winner = ?, updated_at = ? WHERE id = ?`
    ).run(
      JSON.stringify(next), JSON.stringify(fullLog),
      next.winner ? "complete" : "in_progress", next.winner ?? null,
      Date.now(), id
    );

    return NextResponse.json({ state: next, log: fullLog, newLog: newEntries, pending });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to advance battle" }, { status: 500 });
  }
}
