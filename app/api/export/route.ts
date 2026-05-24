import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

interface UnitRow {
  id: number;
  name: string;
  faction: string | null;
  quantity: number;
  stats_json: string | null;
  notes: string | null;
}

interface ArmyUnitRow {
  name: string;
  faction: string | null;
  model_count: number;
  label: string | null;
  custom_points: number | null;
  stats_json: string | null;
}

export async function GET(request: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(request.url);
  const factionFilter = searchParams.get("faction");

  const units = (factionFilter
    ? db.prepare("SELECT * FROM units WHERE stats_json IS NOT NULL AND faction = ? ORDER BY name ASC").all(factionFilter)
    : db.prepare("SELECT * FROM units WHERE stats_json IS NOT NULL ORDER BY faction ASC, name ASC").all()
  ) as UnitRow[];

  // Group by faction
  const byFaction = new Map<string, UnitRow[]>();
  for (const unit of units) {
    const faction = unit.faction || "Unknown";
    if (!byFaction.has(faction)) byFaction.set(faction, []);
    byFaction.get(faction)!.push(unit);
  }

  const lines: string[] = [];
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  lines.push("# Warhammer 40K Collection Export");
  lines.push(`Generated: ${date}`);
  lines.push("");
  lines.push("This file contains my Warhammer 40K model collection organized by faction.");
  lines.push("Use it to suggest an army list within a given point limit.");
  lines.push("**Owned** indicates the number of physical models I have.");
  lines.push("");

  for (const [faction, factionUnits] of byFaction) {
    lines.push(`## ${faction}`);
    lines.push("");

    for (const unit of factionUnits) {
      const stats = unit.stats_json ? JSON.parse(unit.stats_json) : null;
      if (!stats) continue;

      lines.push(`### ${unit.name}`);
      lines.push(`**Owned: ${unit.quantity} model${unit.quantity !== 1 ? "s" : ""}**`);
      lines.push("");

      // Points
      if (stats.points_table && stats.points_table.length > 0) {
        const pts = stats.points_table
          .map((p: { models: number; points: number }) => `${p.models} models = ${p.points}pts`)
          .join(" | ");
        lines.push(`**Points:** ${pts}`);
      } else if (stats.points_per_model) {
        lines.push(`**Points:** ${stats.points_per_model}pts/model`);
      }

      // Core stats
      const statParts: string[] = [];
      if (stats.M)      statParts.push(`M ${stats.M}`);
      if (stats.T)      statParts.push(`T ${stats.T}`);
      if (stats.Sv)     statParts.push(`Sv ${stats.Sv}`);
      if (stats.W)      statParts.push(`W ${stats.W}`);
      if (stats.Ld)     statParts.push(`Ld ${stats.Ld}`);
      if (stats.OC)     statParts.push(`OC ${stats.OC}`);
      if (stats.invuln) statParts.push(`Invuln ${stats.invuln}`);
      if (statParts.length > 0) lines.push(`**Stats:** ${statParts.join(" | ")}`);

      // Keywords
      if (stats.keywords?.length > 0) {
        lines.push(`**Keywords:** ${stats.keywords.join(", ")}`);
      }

      // Abilities
      if (stats.abilities?.length > 0) {
        const abilityText = stats.abilities
          .map((a: { name: string; description: string }) => `${a.name}: ${a.description}`)
          .join("; ");
        lines.push(`**Abilities:** ${abilityText}`);
      }

      // Notes
      if (unit.notes) lines.push(`**Notes:** ${unit.notes}`);

      // Weapons table
      if (stats.weapons?.length > 0) {
        lines.push("");
        lines.push("**Weapons:**");
        lines.push("| Name | Type | Range | A | BS/WS | S | AP | D | Abilities |");
        lines.push("|------|------|-------|---|-------|---|----|---|-----------|");
        for (const w of stats.weapons) {
          const abilities = w.abilities || "—";
          lines.push(`| ${w.name} | ${w.type} | ${w.range} | ${w.attacks} | ${w.bsWs} | ${w.strength} | ${w.ap} | ${w.damage} | ${abilities} |`);
        }
      }

      // Wargear options
      if (stats.wargear_options?.length > 0) {
        lines.push("");
        lines.push("**Wargear Options:**");
        for (const opt of stats.wargear_options) {
          lines.push(`- ${opt}`);
        }
      }

      lines.push("");
    }
  }

  // Existing armies section
  const armies = db.prepare("SELECT * FROM armies ORDER BY created_at DESC").all() as {
    id: number; name: string; point_limit: number;
  }[];

  if (armies.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Existing Armies");
    lines.push("");
    lines.push("These armies are already built. Avoid duplicating these exact lists unless asked.");
    lines.push("");

    for (const army of armies) {
      const armyUnits = db.prepare(`
        SELECT au.model_count, au.label, au.custom_points, u.name, u.faction, u.stats_json
        FROM army_units au
        JOIN units u ON u.id = au.unit_id
        WHERE au.army_id = ?
        ORDER BY au.id ASC
      `).all(army.id) as ArmyUnitRow[];

      const totalPts = armyUnits.reduce((sum, au) => {
        if (au.custom_points !== null) return sum + au.custom_points;
        const stats = au.stats_json ? JSON.parse(au.stats_json) : null;
        return sum + ((stats?.points_per_model ?? 0) * au.model_count);
      }, 0);

      lines.push(`### ${army.name} (${totalPts} / ${army.point_limit}pts)`);
      for (const au of armyUnits) {
        const label = au.label ? ` — ${au.label}` : "";
        lines.push(`- ${au.name} ×${au.model_count}${label}`);
      }
      lines.push("");
    }
  }

  const markdown = lines.join("\n");
  const filename = `wh40k-collection-${date.replace(/\s/g, "-").replace(/,/g, "")}.md`;

  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
