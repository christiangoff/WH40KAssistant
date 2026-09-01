import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { ensureCatalog } from "@/lib/catalog";

// The full unit catalog for the "browse to add" flow. Populated lazily on the
// first request so a fresh install needs no admin setup.
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    await ensureCatalog(db);
    const units = db
      .prepare("SELECT id, name, faction, wahapedia_url, legend FROM catalog_units ORDER BY faction ASC, name ASC")
      .all();
    return NextResponse.json(units);
  } catch (error) {
    console.error("GET /api/catalog error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load catalog" },
      { status: 500 }
    );
  }
}
