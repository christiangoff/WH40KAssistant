import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { ensureFactionSynced } from "@/lib/factionSync";

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const factionId = request.nextUrl.searchParams.get("faction_id");
  if (factionId) await ensureFactionSynced(db, Number(factionId));
  const detachmentIdsParam = request.nextUrl.searchParams.get("detachment_ids");
  const detachmentIds = (detachmentIdsParam ?? "")
    .split(",")
    .map((s) => parseInt(s, 10))
    .filter((n) => !isNaN(n));

  const core = db.prepare("SELECT * FROM stratagems WHERE scope = 'core' ORDER BY name ASC").all();

  const faction = factionId
    ? db.prepare("SELECT * FROM stratagems WHERE scope = 'faction' AND faction_id = ? ORDER BY name ASC").all(factionId)
    : [];

  const byDetachment: Record<number, unknown[]> = {};
  if (detachmentIds.length > 0) {
    const stmt = db.prepare("SELECT * FROM stratagems WHERE scope = 'detachment' AND detachment_id = ? ORDER BY name ASC");
    for (const detId of detachmentIds) {
      byDetachment[detId] = stmt.all(detId);
    }
  }

  return NextResponse.json({ core, faction, byDetachment });
}
