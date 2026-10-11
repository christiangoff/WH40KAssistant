import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { syncFaction, syncChapter } from "@/lib/factionSync";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const db = getDb();
    const faction = db.prepare("SELECT id, name, wahapedia_url, chapter_of FROM factions WHERE id = ?").get(id) as
      | { id: number; name: string; wahapedia_url: string; chapter_of: string | null }
      | undefined;
    if (!faction) return NextResponse.json({ error: "Faction not found" }, { status: 404 });

    // A chapter pseudo-faction (e.g. Dark Angels) shares its `wahapedia_url`
    // with its parent (Space Marines) — scraping it directly via syncFaction
    // would copy every parent detachment in unfiltered, bypassing the
    // chapter's exclusive/excluded list entirely. Route it through
    // syncChapter instead, same as the lazy first-sync path does.
    const result = faction.chapter_of
      ? await syncChapter(db, faction as typeof faction & { chapter_of: string })
      : await syncFaction(db, faction);

    if (result.detachment_count === 0) {
      return NextResponse.json(
        { error: "No detachments found on that page. Check the URL is a current wahapedia.ru/wh40k11ed/factions/... faction page." },
        { status: 422 }
      );
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("POST /api/factions/[id]/sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync faction" },
      { status: 500 }
    );
  }
}
