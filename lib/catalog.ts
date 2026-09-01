import type Database from "better-sqlite3";
import { fetchWahapediaCatalog } from "@/lib/wahapedia";

// Refresh catalog_units from Wahapedia's bulk export. Upserts every current
// datasheet and drops any that have disappeared. Returns the row count.
export async function syncCatalog(db: Database.Database): Promise<number> {
  const countRows = () => (db.prepare("SELECT COUNT(*) AS n FROM catalog_units").get() as { n: number }).n;

  const units = await fetchWahapediaCatalog();
  if (units.length === 0) return countRows(); // export unreachable/empty — keep what we have

  const now = Date.now();
  const upsert = db.prepare(`
    INSERT INTO catalog_units (id, name, faction, wahapedia_url, legend, synced_at)
    VALUES (@id, @name, @faction, @wahapedia_url, @legend, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      faction = excluded.faction,
      wahapedia_url = excluded.wahapedia_url,
      legend = excluded.legend,
      synced_at = excluded.synced_at
  `);

  const run = db.transaction((rows: typeof units) => {
    const keep = new Set<string>();
    for (const u of rows) {
      keep.add(u.id);
      upsert.run({ ...u, synced_at: now });
    }
    const existing = db.prepare("SELECT id FROM catalog_units").all() as { id: string }[];
    const del = db.prepare("DELETE FROM catalog_units WHERE id = ?");
    for (const { id } of existing) if (!keep.has(id)) del.run(id);
  });
  run(units);

  return countRows();
}

// Populate the catalog on first use so a fresh install doesn't need an admin sync.
export async function ensureCatalog(db: Database.Database): Promise<void> {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM catalog_units").get() as { n: number };
  if (n === 0) await syncCatalog(db);
}
