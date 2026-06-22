import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

interface UnitRow {
  id: number;
  name: string;
  faction: string | null;
  quantity: number;
  stats_json: string | null;
  notes: string | null;
}

interface ArmyRow { id: number; name: string; point_limit: number; }
interface ArmyUnitRow {
  name: string;
  squad_name: string | null;
  model_count: number;
  label: string | null;
  custom_points: number | null;
  stats_json: string | null;
}

function getUnits(userId: number, faction: string | null): UnitRow[] {
  const db = getDb();
  return (faction
    ? db.prepare("SELECT * FROM units WHERE stats_json IS NOT NULL AND user_id = ? AND faction = ? ORDER BY name ASC").all(userId, faction)
    : db.prepare("SELECT * FROM units WHERE stats_json IS NOT NULL AND user_id = ? ORDER BY faction ASC, name ASC").all(userId)
  ) as UnitRow[];
}

function getArmies(userId: number): ArmyRow[] {
  return getDb().prepare("SELECT * FROM armies WHERE user_id = ? ORDER BY created_at DESC").all(userId) as ArmyRow[];
}

function getArmyUnits(armyId: number): ArmyUnitRow[] {
  return getDb().prepare(`
    SELECT u.name, aq.name AS squad_name, au.model_count, au.label, au.custom_points, u.stats_json
    FROM army_units au
    JOIN units u ON u.id = au.unit_id
    LEFT JOIN army_squads aq ON aq.id = au.squad_id
    WHERE au.army_id = ?
    ORDER BY CASE WHEN au.squad_id IS NULL THEN 1 ELSE 0 END, au.squad_id, au.id
  `).all(armyId) as ArmyUnitRow[];
}

function unitPoints(au: Pick<ArmyUnitRow, "custom_points" | "model_count" | "stats_json">): number {
  if (au.custom_points !== null) return au.custom_points;
  const stats = au.stats_json ? JSON.parse(au.stats_json) : null;
  return (stats?.points_per_model ?? 0) * au.model_count;
}

// ── Markdown (AI) ────────────────────────────────────────────────────────────

function buildMarkdown(units: UnitRow[], armies: ArmyRow[]): string {
  const byFaction = new Map<string, UnitRow[]>();
  for (const u of units) {
    const f = u.faction || "Unknown";
    if (!byFaction.has(f)) byFaction.set(f, []);
    byFaction.get(f)!.push(u);
  }

  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const lines: string[] = [
    "# Warhammer 40K Collection Export",
    `Generated: ${date}`,
    "",
    "This file contains my Warhammer 40K model collection organized by faction.",
    "Use it to suggest an army list within a given point limit.",
    "**Owned** indicates the number of physical models I have.",
    "",
  ];

  for (const [faction, factionUnits] of byFaction) {
    lines.push(`## ${faction}`, "");
    for (const unit of factionUnits) {
      const stats = unit.stats_json ? JSON.parse(unit.stats_json) : null;
      if (!stats) continue;
      lines.push(`### ${unit.name}`, `**Owned: ${unit.quantity} model${unit.quantity !== 1 ? "s" : ""}**`, "");

      if (stats.points_table?.length > 0) {
        lines.push(`**Points:** ${stats.points_table.map((p: { models: number; points: number }) => `${p.models} models = ${p.points}pts`).join(" | ")}`);
      } else if (stats.points_per_model) {
        lines.push(`**Points:** ${stats.points_per_model}pts/model`);
      }

      const sp: string[] = [];
      if (stats.M)      sp.push(`M ${stats.M}`);
      if (stats.T)      sp.push(`T ${stats.T}`);
      if (stats.Sv)     sp.push(`Sv ${stats.Sv}`);
      if (stats.W)      sp.push(`W ${stats.W}`);
      if (stats.Ld)     sp.push(`Ld ${stats.Ld}`);
      if (stats.OC)     sp.push(`OC ${stats.OC}`);
      if (stats.invuln) sp.push(`Invuln ${stats.invuln}`);
      if (sp.length) lines.push(`**Stats:** ${sp.join(" | ")}`);

      if (stats.keywords?.length)
        lines.push(`**Keywords:** ${stats.keywords.join(", ")}`);
      if (stats.abilities?.length)
        lines.push(`**Abilities:** ${stats.abilities.map((a: { name: string; description: string }) => `${a.name}: ${a.description}`).join("; ")}`);
      if (unit.notes)
        lines.push(`**Notes:** ${unit.notes}`);

      if (stats.weapons?.length) {
        lines.push("", "**Weapons:**",
          "| Name | Type | Range | A | BS/WS | S | AP | D | Abilities |",
          "|------|------|-------|---|-------|---|----|---|-----------|");
        for (const w of stats.weapons)
          lines.push(`| ${w.name} | ${w.type} | ${w.range} | ${w.attacks} | ${w.bsWs} | ${w.strength} | ${w.ap} | ${w.damage} | ${w.abilities || "—"} |`);
      }
      if (stats.wargear_options?.length) {
        lines.push("", "**Wargear Options:**");
        for (const o of stats.wargear_options) lines.push(`- ${o}`);
      }
      lines.push("");
    }
  }

  if (armies.length) {
    lines.push("---", "", "## Existing Armies", "",
      "These armies are already built. Avoid duplicating these exact lists unless asked.", "");
    for (const army of armies) {
      const armyUnits = getArmyUnits(army.id);
      const pts = armyUnits.reduce((s, au) => s + unitPoints(au), 0);
      lines.push(`### ${army.name} (${pts} / ${army.point_limit}pts)`);
      for (const au of armyUnits) lines.push(`- ${au.name} ×${au.model_count}${au.label ? ` — ${au.label}` : ""}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── CSV (Spreadsheet) ────────────────────────────────────────────────────────

function csvCell(val: string | number | null | undefined): string {
  const s = String(val ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(units: UnitRow[]): string {
  const headers = [
    "Name", "Faction", "Owned",
    "Pts/model", "Min Pts", "Max Pts",
    "M", "T", "Sv", "W", "Ld", "OC", "Invuln",
    "Weapons", "Keywords", "Notes",
  ];

  const rows = units.map(unit => {
    const stats = unit.stats_json ? JSON.parse(unit.stats_json) : null;
    const ptsMin = stats?.points_table?.[0]?.points ?? (stats?.points_per_model ?? "");
    const ptsMax = stats?.points_table?.at(-1)?.points ?? (stats?.points_per_model ?? "");
    const weapons = (stats?.weapons ?? []).map((w: { name: string }) => w.name).join("; ");
    const keywords = (stats?.keywords ?? []).join(", ");
    return [
      unit.name, unit.faction ?? "", unit.quantity,
      stats?.points_per_model ?? "", ptsMin, ptsMax,
      stats?.M ?? "", stats?.T ?? "", stats?.Sv ?? "", stats?.W ?? "",
      stats?.Ld ?? "", stats?.OC ?? "", stats?.invuln ?? "",
      weapons, keywords, unit.notes ?? "",
    ].map(csvCell).join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

// ── Army Roster (Text) ───────────────────────────────────────────────────────

function buildRoster(armies: ArmyRow[]): string {
  if (!armies.length) return "No armies found.";
  const lines: string[] = [
    "WARHAMMER 40K ARMY ROSTERS",
    `Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    "",
  ];

  for (const army of armies) {
    const armyUnits = getArmyUnits(army.id);
    const pts = armyUnits.reduce((s, au) => s + unitPoints(au), 0);
    const bar = "═".repeat(Math.max(army.name.length + 20, 40));

    lines.push(bar, `  ${army.name}  [${pts} / ${army.point_limit}pts]`, bar, "");

    // Group by squad
    const squads = new Map<string, ArmyUnitRow[]>();
    for (const au of armyUnits) {
      const key = au.squad_name ?? "__unassigned__";
      if (!squads.has(key)) squads.set(key, []);
      squads.get(key)!.push(au);
    }

    for (const [squadKey, squadUnits] of squads) {
      if (squadKey !== "__unassigned__") lines.push(`  UNIT: ${squadKey}`);
      for (const au of squadUnits) {
        const stats = au.stats_json ? JSON.parse(au.stats_json) : null;
        const auPts = unitPoints(au);
        const label = au.label ? ` [${au.label}]` : "";
        const ptsStr = auPts > 0 ? ` (${auPts}pts)` : "";
        const indent = squadKey !== "__unassigned__" ? "    " : "  ";
        lines.push(`${indent}• ${au.name} ×${au.model_count}${label}${ptsStr}`);
        if (stats) {
          lines.push(`${indent}  M:${stats.M}  T:${stats.T}  Sv:${stats.Sv}  W:${stats.W}  OC:${stats.OC}${stats.invuln ? `  Invuln:${stats.invuln}` : ""}`);
        }
      }
      lines.push("");
    }

    lines.push(`  TOTAL: ${pts}pts  |  ${armyUnits.length} entries`, "", "");
  }

  return lines.join("\n");
}

// ── JSON Backup ──────────────────────────────────────────────────────────────

function buildJson(units: UnitRow[], armies: ArmyRow[]): string {
  const collection = units.map(u => {
    const stats = u.stats_json ? JSON.parse(u.stats_json) : null;
    return {
      name: u.name,
      faction: u.faction,
      owned: u.quantity,
      notes: u.notes,
      wahapedia_url: undefined,
      points_per_model: stats?.points_per_model ?? null,
      points_table: stats?.points_table ?? [],
      stats: stats ? {
        M: stats.M, T: stats.T, Sv: stats.Sv, W: stats.W,
        Ld: stats.Ld, OC: stats.OC, invuln: stats.invuln ?? null,
      } : null,
      keywords: stats?.keywords ?? [],
      abilities: stats?.abilities ?? [],
      weapons: stats?.weapons ?? [],
      wargear_options: stats?.wargear_options ?? [],
    };
  });

  const armiesExport = armies.map(army => {
    const armyUnits = getArmyUnits(army.id);
    const pts = armyUnits.reduce((s, au) => s + unitPoints(au), 0);
    return {
      name: army.name,
      point_limit: army.point_limit,
      total_points: pts,
      units: armyUnits.map(au => ({
        name: au.name,
        unit: au.squad_name,
        model_count: au.model_count,
        label: au.label,
        points: unitPoints(au),
      })),
    };
  });

  return JSON.stringify({
    exported: new Date().toISOString(),
    collection,
    armies: armiesExport,
  }, null, 2);
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const faction = searchParams.get("faction") || null;
  const format = searchParams.get("format") || "md";

  const units = getUnits(user.id, faction);
  const armies = getArmies(user.id);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `wh40k-${stamp}`;

  if (format === "csv") {
    return new NextResponse(buildCsv(units), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}-collection.csv"`,
      },
    });
  }

  if (format === "roster") {
    return new NextResponse(buildRoster(armies), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}-rosters.txt"`,
      },
    });
  }

  if (format === "json") {
    return new NextResponse(buildJson(units, armies), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}-backup.json"`,
      },
    });
  }

  // Default: markdown
  return new NextResponse(buildMarkdown(units, armies), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}-ai.md"`,
    },
  });
}
