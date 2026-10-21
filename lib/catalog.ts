import type Database from "better-sqlite3";
import { fetchWahapediaCatalog } from "@/lib/wahapedia";
import { normalizeWahapediaUrl } from "@/lib/text";

// Refresh catalog_units from Wahapedia's bulk export. Upserts every current
// datasheet and drops any that have disappeared. Returns the row count.
export async function syncCatalog(db: Database.Database): Promise<number> {
  const countRows = () => (db.prepare("SELECT COUNT(*) AS n FROM catalog_units").get() as { n: number }).n;

  const units = await fetchWahapediaCatalog();
  if (units.length === 0) return countRows(); // export unreachable/empty — keep what we have

  const now = Date.now();
  const upsert = db.prepare(`
    INSERT INTO catalog_units (id, name, faction, wahapedia_url, legend, source, content_hash, synced_at)
    VALUES (@id, @name, @faction, @wahapedia_url, @legend, @source, @content_hash, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      faction = excluded.faction,
      wahapedia_url = excluded.wahapedia_url,
      legend = excluded.legend,
      source = excluded.source,
      content_hash = excluded.content_hash,
      synced_at = excluded.synced_at
  `);

  const run = db.transaction((rows: typeof units) => {
    const keep = new Set<string>();
    for (const u of rows) {
      keep.add(u.id);
      upsert.run({ ...u, source: u.source ?? null, synced_at: now });
    }
    const existing = db.prepare("SELECT id FROM catalog_units").all() as { id: string }[];
    const del = db.prepare("DELETE FROM catalog_units WHERE id = ?");
    for (const { id } of existing) if (!keep.has(id)) del.run(id);
  });
  run(units);

  return countRows();
}

const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// After a failed re-sync, don't retry on every request while Wahapedia is down.
const RETRY_AFTER_MS = 10 * 60 * 1000;
let lastFailedSyncAt = 0;

// Populate the catalog on first use so a fresh install doesn't need an admin
// sync, and re-sync once it's a day old: Wahapedia retires and replaces
// datasheets mid-edition (e.g. Custodes' "Custodian Guard" became "Custodian
// Guard Sodality"), and a stale catalog both offers retired units in the
// browse flow and can't flag them in users' collections. A failed re-sync
// keeps the existing rows.
export async function ensureCatalog(db: Database.Database): Promise<void> {
  const { n, synced, unhashed } = db
    .prepare("SELECT COUNT(*) AS n, MIN(synced_at) AS synced, SUM(content_hash IS NULL) AS unhashed FROM catalog_units")
    .get() as { n: number; synced: number | null; unhashed: number | null };
  if (n === 0) {
    await syncCatalog(db);
  } else if (
    (!synced || Date.now() - synced > CATALOG_MAX_AGE_MS || (unhashed ?? 0) > 0) &&
    Date.now() - lastFailedSyncAt > RETRY_AFTER_MS
  ) {
    // unhashed: rows synced before content_hash existed — one-off re-sync.
    await syncCatalog(db).catch((e) => {
      lastFailedSyncAt = Date.now();
      console.error("Catalog re-sync failed; keeping existing rows:", e);
    });
  }
}

// ─── Datasheet resolution ────────────────────────────────────────────────────

export type DatasheetStatus = "current" | "retired" | "unknown";

export interface DatasheetResolution {
  status: DatasheetStatus;
  /** The URL to scrape: the 11th-edition link, moved to its new address if the
   *  same-named datasheet now lives elsewhere. Unchanged for "retired"/"unknown". */
  url: string;
  /** The current datasheet's content fingerprint ("current" only, when known). */
  contentHash: string | null;
}

const urlKey = (url: string) => normalizeWahapediaUrl(url.trim()).replace(/\/+$/, "").toLowerCase();
const factionSlug = (url: string) => url.match(/\/factions\/([^/]+)/i)?.[1]?.toLowerCase() ?? null;
// Catalog names carry a " (Source)" suffix when two sheets share a name.
const nameKey = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();

type CatalogRow = { name: string; wahapedia_url: string; content_hash: string | null };

export function loadCatalogIndex(db: Database.Database) {
  const rows = db.prepare("SELECT name, wahapedia_url, content_hash FROM catalog_units").all() as CatalogRow[];
  const byUrl = new Map(rows.map((r) => [urlKey(r.wahapedia_url), r]));
  const byFactionName = new Map<string, CatalogRow[]>();
  for (const r of rows) {
    const k = `${factionSlug(r.wahapedia_url)}|${nameKey(r.name)}`;
    byFactionName.set(k, [...(byFactionName.get(k) ?? []), r]);
  }
  return { size: rows.length, byUrl, byFactionName };
}

// Is this unit link a datasheet Wahapedia currently publishes for 11th
// edition? Wahapedia keeps serving retired datasheets at their old address
// (under /wh40k11ed/ too, with the OLD rules), so a 200 response proves
// nothing — the bulk Datasheets.csv export behind catalog_units is the list of
// what's current. A datasheet that only moved address (same faction, same
// name, e.g. "Terminator-Squad-1" -> "Terminator-Squad") resolves to its new
// URL; anything else not in the catalog is retired, and picking its
// replacement is left to the user (renames/splits like Custodian Guard ->
// three "Sodality" sheets can't be matched safely by name).
export function resolveDatasheet(
  index: ReturnType<typeof loadCatalogIndex>,
  url: string,
  unitName: string | null
): DatasheetResolution {
  const normalized = normalizeWahapediaUrl(url.trim());
  if (index.size === 0) return { status: "unknown", url: normalized, contentHash: null };
  const hit = index.byUrl.get(urlKey(url));
  if (hit) return { status: "current", url: hit.wahapedia_url, contentHash: hit.content_hash };
  if (unitName) {
    const same = index.byFactionName.get(`${factionSlug(url)}|${nameKey(unitName)}`);
    if (same?.length === 1) return { status: "current", url: same[0].wahapedia_url, contentHash: same[0].content_hash };
  }
  return { status: "retired", url: normalized, contentHash: null };
}

// A collection unit's datasheet status (null = not Wahapedia-linked, or no
// catalog to check against):
//   "current"  — stored stats came from the current 11th-edition datasheet
//   "outdated" — a current datasheet exists but the stored stats came from
//                elsewhere (old edition / old address) or from an earlier
//                revision of it (content fingerprint changed)
//   "retired"  — Wahapedia no longer publishes this datasheet; the user picks
//                a replacement
export type UnitDatasheetStatus = "current" | "outdated" | "retired" | null;

export function unitDatasheetStatus(
  index: ReturnType<typeof loadCatalogIndex>,
  unit: { name: string | null; wahapedia_url: string | null; datasheet_url: string | null; datasheet_hash: string | null; stats_json: string | null }
): UnitDatasheetStatus {
  if (!unit.wahapedia_url?.trim()) return null;
  const r = resolveDatasheet(index, unit.wahapedia_url, unit.name);
  if (r.status === "unknown") return null;
  if (r.status === "retired") return "retired";
  return unit.stats_json && unit.datasheet_url === r.url && (!r.contentHash || unit.datasheet_hash === r.contentHash)
    ? "current"
    : "outdated";
}
