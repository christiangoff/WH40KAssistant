import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = getUserFromRequest(request);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const db = getDb();

    const owner = db
      .prepare("SELECT id, username FROM users WHERE id = ? AND archived = 0")
      .get(id) as { id: number; username: string } | undefined;
    if (!owner) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const units = db
      .prepare(
        `SELECT name, faction, quantity, stats_json
         FROM units WHERE user_id = ? ORDER BY faction ASC, name ASC`
      )
      .all(id) as { name: string; faction: string | null; quantity: number; stats_json: string | null }[];

    return NextResponse.json({ owner, units });
  } catch (error) {
    console.error("GET /api/users/[id]/collection error:", error);
    return NextResponse.json({ error: "Failed to fetch collection" }, { status: 500 });
  }
}
