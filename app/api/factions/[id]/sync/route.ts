import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { scrapeWahapediaFaction, scrapeWahapediaCoreStratagems } from "@/lib/wahapedia";
import { normalizeFactionName } from "@/lib/text";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const db = getDb();
    const faction = db.prepare("SELECT * FROM factions WHERE id = ?").get(id) as
      | { id: number; name: string; wahapedia_url: string }
      | undefined;
    if (!faction) return NextResponse.json({ error: "Faction not found" }, { status: 404 });

    const [factionData, coreStratagems] = await Promise.all([
      scrapeWahapediaFaction(faction.wahapedia_url),
      scrapeWahapediaCoreStratagems(),
    ]);

    const sync = db.transaction(() => {
      // Core stratagems are global reference data, not faction-scoped — refresh them every sync.
      db.prepare("DELETE FROM stratagems WHERE scope = 'core'").run();
      const insertStratagem = db.prepare(`
        INSERT INTO stratagems (scope, faction_id, detachment_id, name, cp, type, legend, when_text, target_text, effect_text, restrictions)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const s of coreStratagems) {
        insertStratagem.run("core", null, null, s.name, s.cp, s.type, s.legend, s.when, s.target, s.effect, s.restrictions ?? null);
      }

      // Replace this faction's detachments (cascades to enhancements/detachment stratagems) and faction-wide stratagems.
      db.prepare("DELETE FROM detachments WHERE faction_id = ?").run(faction.id);
      db.prepare("DELETE FROM stratagems WHERE scope = 'faction' AND faction_id = ?").run(faction.id);

      const insertDetachment = db.prepare(`
        INSERT INTO detachments (faction_id, name, dp_cost, unique_tag, force_disposition, rule_name, rule_text)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertEnhancement = db.prepare(`
        INSERT INTO enhancements (detachment_id, name, points, description) VALUES (?, ?, ?, ?)
      `);

      for (const d of factionData.detachments) {
        const detResult = insertDetachment.run(
          faction.id, d.name, d.dpCost, d.uniqueTag, d.forceDisposition, d.ruleName, d.ruleText
        );
        const detachmentId = detResult.lastInsertRowid;

        for (const e of d.enhancements) {
          insertEnhancement.run(detachmentId, e.name, e.points, e.description);
        }
        for (const s of d.stratagems) {
          insertStratagem.run(
            "detachment", faction.id, detachmentId,
            s.name, s.cp, s.type, s.legend, s.when, s.target, s.effect, s.restrictions ?? null
          );
        }
      }

      for (const s of factionData.factionStratagems) {
        insertStratagem.run("faction", faction.id, null, s.name, s.cp, s.type, s.legend, s.when, s.target, s.effect, s.restrictions ?? null);
      }

      db.prepare("UPDATE factions SET synced_at = ? WHERE id = ?").run(Date.now(), faction.id);

      // Auto-link armies whose free-text faction loosely matches this faction's name
      // (e.g. "T Au Empire" vs "T'au Empire") and aren't linked to any faction yet.
      const targetNorm = normalizeFactionName(faction.name);
      const unlinked = db
        .prepare("SELECT id, faction FROM armies WHERE faction_id IS NULL AND faction IS NOT NULL")
        .all() as { id: number; faction: string }[];
      const linkArmy = db.prepare("UPDATE armies SET faction_id = ? WHERE id = ?");
      let autoLinkedCount = 0;
      for (const army of unlinked) {
        if (normalizeFactionName(army.faction) === targetNorm) {
          linkArmy.run(faction.id, army.id);
          autoLinkedCount++;
        }
      }
      return autoLinkedCount;
    });

    const autoLinkedCount = sync();

    const detachmentCount = (db.prepare("SELECT COUNT(*) as n FROM detachments WHERE faction_id = ?").get(faction.id) as { n: number }).n;
    return NextResponse.json({
      success: true,
      detachment_count: detachmentCount,
      core_stratagem_count: coreStratagems.length,
      faction_stratagem_count: factionData.factionStratagems.length,
      auto_linked_count: autoLinkedCount,
    });
  } catch (error) {
    console.error("POST /api/factions/[id]/sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync faction" },
      { status: 500 }
    );
  }
}
