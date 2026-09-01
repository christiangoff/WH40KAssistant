import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { syncAllFactions } from "@/lib/factionSync";

// Admin-only: (re-)sync every faction's detachment data from Wahapedia. Streams
// newline-delimited JSON progress — the whole run takes a couple of minutes.
export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const summary = await syncAllFactions(db, (p) => {
          send({ type: "progress", done: p.done, total: p.total, faction: p.faction, ok: p.ok, detachments: p.detachments ?? 0 });
        });
        send({ type: "done", ...summary });
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : "Sync failed" });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
