import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { buildUnitStats, persistUnitStats } from "@/lib/unitStats";
import type { UnitStats } from "@/lib/wahapedia";

// Admin-only: re-scrape stats + MFM points for every Wahapedia-linked unit across
// ALL users. Streams newline-delimited JSON progress so the admin UI can show a
// counter — this can take several minutes on a large database.
export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const units = db
    .prepare(
      "SELECT id, name, wahapedia_url FROM units WHERE wahapedia_url IS NOT NULL AND TRIM(wahapedia_url) != '' ORDER BY id ASC"
    )
    .all() as { id: number; name: string | null; wahapedia_url: string }[];

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
          let stats = cache.get(unit.wahapedia_url);
          if (!stats) {
            stats = await buildUnitStats(unit.wahapedia_url);
            cache.set(unit.wahapedia_url, stats);
          }
          persistUnitStats(db, unit.id, unit.name, stats);
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
