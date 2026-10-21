import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { buildUnitStats, refreshUnitDatasheet } from "@/lib/unitStats";
import { ensureCatalog, loadCatalogIndex, unitDatasheetStatus } from "@/lib/catalog";
import type { UnitStats } from "@/lib/wahapedia";

// Admin-only: re-scrape stats + MFM points for Wahapedia-linked units across
// ALL users — every one, or with {"scope":"outdated"} only those whose stored
// datasheet no longer matches the current 11th-edition one. Streams newline-delimited JSON progress so the admin UI can show a
// counter — this can take several minutes on a large database.
export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const outdatedOnly = body?.scope === "outdated";

  const db = getDb();
  await ensureCatalog(db).catch(() => {});
  const index = loadCatalogIndex(db);
  const units = (
    db
      .prepare(
        "SELECT id, name, wahapedia_url, datasheet_url, datasheet_hash, stats_json FROM units WHERE wahapedia_url IS NOT NULL AND TRIM(wahapedia_url) != '' ORDER BY id ASC"
      )
      .all() as { id: number; name: string | null; wahapedia_url: string; datasheet_url: string | null; datasheet_hash: string | null; stats_json: string | null }[]
  ).filter((u) => !outdatedOnly || unitDatasheetStatus(index, u) === "outdated");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      // Multiple users often link the same unit page — scrape each URL once.
      const cache = new Map<string, UnitStats>();
      let succeeded = 0;
      let failed = 0;

      send({ type: "start", total: units.length });

      for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        try {
          await refreshUnitDatasheet(db, unit, index, async (url) => {
            let stats = cache.get(url);
            if (!stats) {
              stats = await buildUnitStats(url);
              cache.set(url, stats);
            }
            return stats;
          });
          succeeded++;
        } catch {
          // one unit failing (dead link, site down) shouldn't stop the rest
          failed++;
        }
        send({ type: "progress", done: i + 1, total: units.length, name: unit.name ?? "?" });
      }

      send({
        type: "done",
        total: units.length,
        succeeded,
        failed,
        unique_pages: cache.size,
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
