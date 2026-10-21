import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { ensureCatalog, loadCatalogIndex, syncCatalog, unitDatasheetStatus } from "@/lib/catalog";

// Admin-only: how every user's collection stands against Wahapedia's current
// 11th-edition datasheets. ?sync=1 re-pulls the catalog first, so revisions
// Wahapedia published since the last daily sync show up as "outdated".
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  let syncError: string | null = null;
  if (request.nextUrl.searchParams.get("sync") === "1") {
    await syncCatalog(db).catch((e) => {
      syncError = e instanceof Error ? e.message : "Catalog sync failed";
    });
  } else {
    await ensureCatalog(db).catch(() => {});
  }

  const catalog = db
    .prepare("SELECT COUNT(*) AS count, MIN(synced_at) AS synced_at FROM catalog_units")
    .get() as { count: number; synced_at: number | null };
  const index = loadCatalogIndex(db);
  const units = db
    .prepare(
      `SELECT u.id, u.name, u.faction, u.wahapedia_url, u.datasheet_url, u.datasheet_hash, u.stats_json,
              u.stats_fetched_at, us.username AS owner
       FROM units u LEFT JOIN users us ON us.id = u.user_id
       ORDER BY u.faction ASC, u.name ASC`
    )
    .all() as {
      id: number; name: string | null; faction: string | null; wahapedia_url: string | null;
      datasheet_url: string | null; datasheet_hash: string | null; stats_json: string | null;
      stats_fetched_at: number | null; owner: string | null;
    }[];

  const counts = { current: 0, outdated: 0, retired: 0, unlinked: 0 };
  const attention: { id: number; name: string | null; faction: string | null; owner: string | null; status: "outdated" | "retired"; wahapedia_url: string | null; stats_fetched_at: number | null }[] = [];
  for (const u of units) {
    const status = unitDatasheetStatus(index, u);
    if (status === null) counts.unlinked++;
    else counts[status]++;
    if (status === "outdated" || status === "retired") {
      attention.push({ id: u.id, name: u.name, faction: u.faction, owner: u.owner, status, wahapedia_url: u.wahapedia_url, stats_fetched_at: u.stats_fetched_at });
    }
  }

  return NextResponse.json({ catalog, counts, units: attention, sync_error: syncError });
}
