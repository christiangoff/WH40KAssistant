import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { resolveBattleSize } from "@/lib/battleSize";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const db = getDb();

    const army = db.prepare("SELECT * FROM armies WHERE id = ? AND user_id = ?").get(id, user.id) as
      | { id: number; point_limit: number }
      | undefined;
    if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    const { detachment_id } = await request.json();
    const detachment = db.prepare("SELECT * FROM detachments WHERE id = ?").get(detachment_id) as
      | { id: number; dp_cost: number; unique_tag: string | null; name: string }
      | undefined;
    if (!detachment) return NextResponse.json({ error: "Detachment not found" }, { status: 404 });

    const selected = db.prepare(`
      SELECT d.* FROM army_detachments ad JOIN detachments d ON d.id = ad.detachment_id WHERE ad.army_id = ?
    `).all(id) as { id: number; dp_cost: number; unique_tag: string | null; name: string }[];

    if (selected.some((d) => d.id === detachment.id)) {
      return NextResponse.json({ error: "Detachment already selected" }, { status: 400 });
    }

    if (detachment.unique_tag) {
      const clash = selected.find((d) => d.unique_tag === detachment.unique_tag);
      if (clash) {
        return NextResponse.json(
          { error: `${detachment.name} shares the "${detachment.unique_tag}" tag with ${clash.name} — only one can be selected` },
          { status: 400 }
        );
      }
    }

    const battleSize = resolveBattleSize(army.point_limit);
    const dpUsed = selected.reduce((sum, d) => sum + d.dp_cost, 0);
    if (battleSize && dpUsed + detachment.dp_cost > battleSize.dp_budget) {
      return NextResponse.json(
        { error: `Adding ${detachment.name} (${detachment.dp_cost} DP) would exceed the ${battleSize.dp_budget} DP budget for ${battleSize.name}` },
        { status: 400 }
      );
    }

    db.prepare("INSERT INTO army_detachments (army_id, detachment_id) VALUES (?, ?)").run(id, detachment.id);

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("POST /api/armies/[id]/detachments error:", error);
    return NextResponse.json({ error: "Failed to add detachment" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const db = getDb();
    const army = db.prepare("SELECT id FROM armies WHERE id = ? AND user_id = ?").get(id, user.id);
    if (!army) return NextResponse.json({ error: "Army not found" }, { status: 404 });

    const { detachment_id } = await request.json();
    db.prepare("DELETE FROM army_detachments WHERE army_id = ? AND detachment_id = ?").run(id, detachment_id);
    db.prepare("UPDATE army_units SET detachment_id = NULL WHERE army_id = ? AND detachment_id = ?").run(id, detachment_id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/armies/[id]/detachments error:", error);
    return NextResponse.json({ error: "Failed to remove detachment" }, { status: 500 });
  }
}
