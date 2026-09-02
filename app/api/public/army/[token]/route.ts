import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { ensureCoreStratagems, ensureFactionSynced } from "@/lib/factionSync";

// No auth: serves a read-only army bundle for a valid public share token.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!token || token.length < 8) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const db = getDb();
    const army = db.prepare(`
      SELECT a.*, u.username AS owner_username, f.army_rule_name, f.army_rule_text
      FROM armies a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN factions f ON f.id = a.faction_id
      WHERE a.public_token = ?
    `).get(token) as
      | { id: number; faction_id: number | null; public_token: string }
      | undefined;
    if (!army) return NextResponse.json({ error: "This share link is no longer active." }, { status: 404 });

    const units = db.prepare(`
      SELECT au.*, u.name, u.faction, u.stats_json, u.wahapedia_url, u.quantity as owned_models,
             e.name AS enhancement_name, e.points AS enhancement_points, e.description AS enhancement_description
      FROM army_units au JOIN units u ON u.id = au.unit_id
      LEFT JOIN enhancements e ON e.id = au.enhancement_id
      WHERE au.army_id = ? ORDER BY au.id ASC
    `).all(army.id);

    const squads = db.prepare("SELECT * FROM army_squads WHERE army_id = ? ORDER BY id ASC").all(army.id);

    const detachments = db.prepare(`
      SELECT d.* FROM army_detachments ad JOIN detachments d ON d.id = ad.detachment_id
      WHERE ad.army_id = ? ORDER BY d.name ASC
    `).all(army.id) as { id: number }[];

    // Stratagems — same as /api/stratagems, but bundled since the public page can't call an authed route.
    await ensureCoreStratagems(db).catch(() => {});
    if (army.faction_id) await ensureFactionSynced(db, army.faction_id).catch(() => {});
    const core = db.prepare("SELECT * FROM stratagems WHERE scope = 'core' ORDER BY name ASC").all();
    const byDetachmentStmt = db.prepare("SELECT * FROM stratagems WHERE scope = 'detachment' AND detachment_id = ? ORDER BY name ASC");
    const byDetachment: Record<number, unknown[]> = {};
    for (const d of detachments) byDetachment[d.id] = byDetachmentStmt.all(d.id);

    return NextResponse.json({
      army: { ...army, public_token: undefined, is_owner: false, units, squads, detachments },
      stratagemGroups: { core, byDetachment },
    });
  } catch (error) {
    console.error("GET /api/public/army/[token] error:", error);
    return NextResponse.json({ error: "Failed to load army" }, { status: 500 });
  }
}
