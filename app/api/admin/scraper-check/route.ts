import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { ensureCatalog, loadCatalogIndex, resolveDatasheet } from "@/lib/catalog";
import { checkDatasheet, loadScraperCheckData } from "@/lib/scraperCheck";

// Admin-only: scrape a set of datasheets and compare them with Wahapedia's
// 11th-edition CSV export (see lib/scraperCheck.ts). Checks every datasheet
// in use in someone's collection plus a random sample from each faction, so
// repeated runs cover more of the game. Streams NDJSON progress.
const SAMPLE_PER_FACTION = 1;
const DELAY_MS = 250; // be gentle with Wahapedia

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  await ensureCatalog(db).catch(() => {});
  const index = loadCatalogIndex(db);

  const targets = new Map<string, "collection" | "sample">();
  const linked = db
    .prepare("SELECT name, wahapedia_url FROM units WHERE wahapedia_url IS NOT NULL AND TRIM(wahapedia_url) != ''")
    .all() as { name: string | null; wahapedia_url: string }[];
  for (const u of linked) {
    const r = resolveDatasheet(index, u.wahapedia_url, u.name);
    if (r.status === "current") targets.set(r.url, "collection");
  }
  const byFaction = new Map<string, string[]>();
  for (const row of index.byUrl.values()) {
    const slug = row.wahapedia_url.match(/\/factions\/([^/]+)/)?.[1] ?? "";
    byFaction.set(slug, [...(byFaction.get(slug) ?? []), row.wahapedia_url]);
  }
  for (const urls of byFaction.values()) {
    const pool = urls.filter((u) => !targets.has(u));
    for (let i = 0; i < SAMPLE_PER_FACTION && pool.length > 0; i++) {
      targets.set(pool.splice(Math.floor(Math.random() * pool.length), 1)[0], "sample");
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      let data;
      try {
        data = await loadScraperCheckData();
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : "Couldn't download Wahapedia's export" });
        controller.close();
        return;
      }

      const list = [...targets];
      send({ type: "start", total: list.length });
      let passed = 0;
      let failed = 0;
      let errored = 0;
      for (let i = 0; i < list.length; i++) {
        const [url, source] = list[i];
        try {
          const result = await checkDatasheet(data, url);
          if (result.problems.length === 0) passed++;
          else {
            failed++;
            send({ type: "mismatch", source, ...result });
          }
        } catch (e) {
          errored++;
          send({ type: "mismatch", source, name: url, url, problems: [`Scrape failed: ${e instanceof Error ? e.message : e}`] });
        }
        send({ type: "progress", done: i + 1, total: list.length });
        if (i < list.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
      }
      send({ type: "done", total: list.length, passed, failed, errored });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
