import type Database from "better-sqlite3";
import {
  scrapeWahapediaFaction,
  scrapeWahapediaCoreStratagems,
  fetchAllFactionCsvs,
  type Stratagem,
  type WahapediaCsvExports,
} from "@/lib/wahapedia";
import { normalizeFactionName, normalizeWahapediaUrl } from "@/lib/text";

type FactionRow = { id: number; name: string; wahapedia_url: string };

export interface FactionSyncResult {
  detachment_count: number;
  core_stratagem_count: number;
  faction_stratagem_count: number;
  auto_linked_count: number;
}

// One faction: scrape its detachments / enhancements / stratagems / army rule
// from Wahapedia and upsert them. Extracted from the per-faction sync route so
// the lazy path and the "sync all" batch can reuse it.
export async function syncFaction(
  db: Database.Database,
  faction: FactionRow,
  opts: { coreStratagems?: Stratagem[]; csvs?: WahapediaCsvExports } = {}
): Promise<FactionSyncResult> {
  const url = normalizeWahapediaUrl(faction.wahapedia_url);
  if (url !== faction.wahapedia_url) {
    db.prepare("UPDATE factions SET wahapedia_url = ? WHERE id = ?").run(url, faction.id);
  }

  const [factionData, coreStratagems] = await Promise.all([
    scrapeWahapediaFaction(url, faction.name, opts.csvs),
    opts.coreStratagems ? Promise.resolve(opts.coreStratagems) : scrapeWahapediaCoreStratagems(),
  ]);

  const apply = db.transaction(() => {
    // Core stratagems are global reference data, not faction-scoped.
    db.prepare("DELETE FROM stratagems WHERE scope = 'core'").run();
    const insertStratagem = db.prepare(`
      INSERT INTO stratagems (scope, faction_id, detachment_id, name, cp, type, legend, when_text, target_text, effect_text, restrictions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const s of coreStratagems) {
      insertStratagem.run("core", null, null, s.name, s.cp, s.type, s.legend, s.when, s.target, s.effect, s.restrictions ?? null);
    }

    db.prepare("DELETE FROM stratagems WHERE scope = 'faction' AND faction_id = ?").run(faction.id);

    // Detachments are upserted (matched on faction_id+name) rather than deleted
    // and recreated: armies can already reference a detachment's id, and
    // replacing the row would break that FK / orphan the selection on every sync.
    const upsertDetachment = db.prepare(`
      INSERT INTO detachments (faction_id, name, dp_cost, unique_tag, force_disposition, rule_name, rule_text)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(faction_id, name) DO UPDATE SET
        dp_cost = excluded.dp_cost,
        unique_tag = excluded.unique_tag,
        force_disposition = excluded.force_disposition,
        rule_name = excluded.rule_name,
        rule_text = excluded.rule_text
    `);
    const getDetachmentId = db.prepare("SELECT id FROM detachments WHERE faction_id = ? AND name = ?");
    const deleteEnhancements = db.prepare("DELETE FROM enhancements WHERE detachment_id = ?");
    const insertEnhancement = db.prepare("INSERT INTO enhancements (detachment_id, name, points, description) VALUES (?, ?, ?, ?)");
    const deleteDetachmentStratagems = db.prepare("DELETE FROM stratagems WHERE scope = 'detachment' AND detachment_id = ?");

    for (const d of factionData.detachments) {
      upsertDetachment.run(faction.id, d.name, d.dpCost, d.uniqueTag, d.forceDisposition, d.ruleName, d.ruleText);
      const detachmentId = (getDetachmentId.get(faction.id, d.name) as { id: number }).id;

      deleteEnhancements.run(detachmentId);
      for (const e of d.enhancements) {
        insertEnhancement.run(detachmentId, e.name, e.points, e.description);
      }

      deleteDetachmentStratagems.run(detachmentId);
      for (const s of d.stratagems) {
        insertStratagem.run(
          "detachment", faction.id, detachmentId,
          s.name, s.cp, s.type, s.legend, s.when, s.target, s.effect, s.restrictions ?? null
        );
      }
    }
    // Detachments no longer on the page are left in place (may still be referenced by an army).

    for (const s of factionData.factionStratagems) {
      insertStratagem.run("faction", faction.id, null, s.name, s.cp, s.type, s.legend, s.when, s.target, s.effect, s.restrictions ?? null);
    }

    // Mark synced even at zero detachments (odd factions like Adeptus Titanicus /
    // Unbound Adversaries) so the lazy path doesn't retry forever.
    db.prepare("UPDATE factions SET synced_at = ?, army_rule_name = ?, army_rule_text = ? WHERE id = ?")
      .run(Date.now(), factionData.armyRuleName || null, factionData.armyRuleText || null, faction.id);

    // Auto-link armies whose free-text faction loosely matches this faction and aren't linked yet.
    const targetNorm = normalizeFactionName(faction.name);
    const unlinked = db
      .prepare("SELECT id, faction FROM armies WHERE faction_id IS NULL AND faction IS NOT NULL")
      .all() as { id: number; faction: string }[];
    const linkArmy = db.prepare("UPDATE armies SET faction_id = ? WHERE id = ?");
    let autoLinkedCount = 0;
    for (const army of unlinked) {
      if (normalizeFactionName(army.faction) === targetNorm) {
        linkArmy.run(faction.id, army.id);
        autoLinkedCount++;
      }
    }
    return autoLinkedCount;
  });

  const auto_linked_count = apply();
  const detachment_count = (db.prepare("SELECT COUNT(*) AS n FROM detachments WHERE faction_id = ?").get(faction.id) as { n: number }).n;

  return {
    detachment_count,
    core_stratagem_count: coreStratagems.length,
    faction_stratagem_count: factionData.factionStratagems.length,
    auto_linked_count,
  };
}

// Populate the `factions` table from Wahapedia's faction list so every faction
// is available even before it's synced. Cheap (one CSV fetch); no-op once the
// table is full.
export async function ensureAllFactions(db: Database.Database): Promise<void> {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM factions").get() as { n: number }).n;
  if (count >= 20) return;

  const { factions } = await fetchAllFactionCsvs();
  const existing = new Set(
    (db.prepare("SELECT name FROM factions").all() as { name: string }[]).map((r) => normalizeFactionName(r.name))
  );
  const insert = db.prepare("INSERT INTO factions (name, wahapedia_url) VALUES (?, ?)");
  const run = db.transaction(() => {
    for (const f of factions) {
      const name = (f.name || "").trim();
      const link = (f.link || "").trim();
      if (!name || !link || !link.includes("/factions/")) continue;
      if (/unbound adversaries/i.test(name)) continue; // misc bucket — no detachments
      if (existing.has(normalizeFactionName(name))) continue;
      insert.run(name, normalizeWahapediaUrl(link));
      existing.add(normalizeFactionName(name));
    }
  });
  run();
}

// Concurrent /api/detachments + /api/stratagems requests for the same faction
// should only kick off one sync.
const inFlight = new Map<number, Promise<void>>();

export async function ensureFactionSynced(db: Database.Database, factionId: number): Promise<void> {
  if (!Number.isFinite(factionId)) return;
  const row = db.prepare("SELECT id, name, wahapedia_url, synced_at FROM factions WHERE id = ?").get(factionId) as
    | (FactionRow & { synced_at: number | null })
    | undefined;
  if (!row || row.synced_at) return;

  const running = inFlight.get(factionId);
  if (running) return running;

  const p = (async () => {
    try {
      await syncFaction(db, row);
    } catch (err) {
      // Leave synced_at null so it retries next time; don't break the GET.
      console.error(`ensureFactionSynced(${factionId}) failed:`, err);
    } finally {
      inFlight.delete(factionId);
    }
  })();
  inFlight.set(factionId, p);
  return p;
}

export interface SyncAllProgress {
  done: number;
  total: number;
  faction: string;
  ok: boolean;
  detachments?: number;
}

// Re-sync every faction. Shares the core-stratagem + faction-CSV downloads
// across the batch and keeps going if one faction fails.
export async function syncAllFactions(
  db: Database.Database,
  onProgress?: (p: SyncAllProgress) => void
): Promise<{ total: number; synced: number; failed: number }> {
  await ensureAllFactions(db);
  const [csvs, coreStratagems] = await Promise.all([
    fetchAllFactionCsvs(),
    scrapeWahapediaCoreStratagems(),
  ]);

  const factions = db.prepare("SELECT id, name, wahapedia_url FROM factions ORDER BY name ASC").all() as FactionRow[];
  let synced = 0;
  let failed = 0;

  for (let i = 0; i < factions.length; i++) {
    const f = factions[i];
    try {
      const r = await syncFaction(db, f, { coreStratagems, csvs });
      synced++;
      onProgress?.({ done: i + 1, total: factions.length, faction: f.name, ok: true, detachments: r.detachment_count });
    } catch (err) {
      failed++;
      console.error(`syncAllFactions: ${f.name} failed:`, err);
      onProgress?.({ done: i + 1, total: factions.length, faction: f.name, ok: false });
    }
  }

  return { total: factions.length, synced, failed };
}
