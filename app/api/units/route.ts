import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { normalizeWahapediaUrl } from "@/lib/text";
import { ensureCatalog, loadCatalogIndex, unitDatasheetStatus } from "@/lib/catalog";

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const units = db
    .prepare("SELECT * FROM units WHERE user_id = ? ORDER BY faction ASC, name ASC")
    .all(user.id) as UnitRow[];

  // datasheet_status per unit — see unitDatasheetStatus(). "outdated" units are
  // re-fetched by the collection page; "retired" ones need the user to pick a
  // replacement.
  await ensureCatalog(db).catch(() => {});
  const index = loadCatalogIndex(db);
  const withStatus = units.map((u) => ({ ...u, datasheet_status: unitDatasheetStatus(index, u) }));
  return NextResponse.json(withStatus);
}

interface UnitRow {
  name: string | null;
  wahapedia_url: string | null;
  datasheet_url: string | null;
  datasheet_hash: string | null;
  stats_json: string | null;
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const body = await request.json();
    const { name, faction, wahapedia_url, quantity = 1, stats_json } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const result = db
      .prepare(
        "INSERT INTO units (name, faction, wahapedia_url, quantity, stats_json, user_id) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(name, faction ?? null, wahapedia_url ? normalizeWahapediaUrl(wahapedia_url) : null, quantity, stats_json ?? null, user.id);

    const unit = db.prepare("SELECT * FROM units WHERE id = ?").get(result.lastInsertRowid);
    return NextResponse.json(unit, { status: 201 });
  } catch (error) {
    console.error("POST /api/units error:", error);
    return NextResponse.json({ error: "Failed to create unit" }, { status: 500 });
  }
}
