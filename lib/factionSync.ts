import type Database from "better-sqlite3";
import {
  scrapeWahapediaFaction,
  scrapeWahapediaCoreStratagems,
  fetchAllFactionCsvs,
  type Stratagem,
  type WahapediaCsvExports,
} from "@/lib/wahapedia";
import { fetchMFMDetachments } from "@/lib/mfm";
import { normalizeFactionName, normalizeWahapediaUrl } from "@/lib/text";
import { CHAPTERS, findChapter } from "@/lib/chapters";

type FactionRow = { id: number; name: string; wahapedia_url: string };

export interface FactionSyncResult {
  detachment_count: number;
  core_stratagem_count: number;
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

  const [factionData, coreStratagems, mfmDetachments] = await Promise.all([
    scrapeWahapediaFaction(url, faction.name, opts.csvs),
    opts.coreStratagems ? Promise.resolve(opts.coreStratagems) : scrapeWahapediaCoreStratagems(),
    // MFM is the source of truth for DP costs and enhancement points; Wahapedia
    // stays the source for the rules / stratagem / enhancement *text*. Overlay
    // the numbers by name — best-effort, never fatal.
    fetchMFMDetachments(faction.name).catch(() => []),
  ]);

  if (mfmDetachments.length > 0) {
    const norm = (s: string) => normalizeFactionName(s);
    // Strip trailing qualifiers MFM/Wahapedia disagree on — "(Upgrade)", "(Aura)", …
    const normEnh = (s: string) => norm(s.replace(/\([^)]*\)/g, ""));
    const mfmByName = new Map(mfmDetachments.map((d) => [norm(d.name), d]));
    for (const d of factionData.detachments) {
      const mfm = mfmByName.get(norm(d.name));
      if (!mfm) continue;
      d.dpCost = mfm.dpCost;
      const mfmEnhPoints = new Map(mfm.enhancements.map((e) => [normEnh(e.name), e.points]));
      for (const e of d.enhancements) {
        const pts = mfmEnhPoints.get(normEnh(e.name));
        if (pts != null) e.points = pts;
      }
    }
  }

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

    // Clear any old scope='faction' rows — matched play has no faction-wide
    // stratagems; earlier syncs mis-filed Boarding Actions cards here.
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
    // Enhancements are upserted on (detachment_id, name) — never blindly
    // deleted — because army_units.enhancement_id may point at one, and with
    // foreign_keys ON a DELETE of a referenced row fails the whole sync
    // ("FOREIGN KEY constraint failed"). Same reasoning as detachments above.
    const existingEnhancements = db.prepare("SELECT id, name FROM enhancements WHERE detachment_id = ?");
    const updateEnhancement = db.prepare(
      "UPDATE enhancements SET points = ?, description = ?, eligibility = ?, eligibility_scope = ? WHERE id = ?"
    );
    const insertEnhancement = db.prepare(
      "INSERT INTO enhancements (detachment_id, name, points, description, eligibility, eligibility_scope) VALUES (?, ?, ?, ?, ?, ?)"
    );
    // Prune an enhancement dropped from the page only if no army still uses it.
    const deleteOrphanEnhancement = db.prepare(
      "DELETE FROM enhancements WHERE id = ? AND id NOT IN (SELECT enhancement_id FROM army_units WHERE enhancement_id IS NOT NULL)"
    );
    const deleteDetachmentStratagems = db.prepare("DELETE FROM stratagems WHERE scope = 'detachment' AND detachment_id = ?");

    for (const d of factionData.detachments) {
      upsertDetachment.run(faction.id, d.name, d.dpCost, d.uniqueTag, d.forceDisposition, d.ruleName, d.ruleText);
      const detachmentId = (getDetachmentId.get(faction.id, d.name) as { id: number }).id;

      const priorEnhancements = existingEnhancements.all(detachmentId) as { id: number; name: string }[];
      const enhancementIdByName = new Map(priorEnhancements.map((r) => [r.name, r.id]));
      const scrapedNames = new Set<string>();
      for (const e of d.enhancements) {
        scrapedNames.add(e.name);
        const existingId = enhancementIdByName.get(e.name);
        if (existingId != null) {
          updateEnhancement.run(e.points, e.description, e.eligibility ?? null, e.eligibilityScope ?? null, existingId);
        } else {
          insertEnhancement.run(detachmentId, e.name, e.points, e.description, e.eligibility ?? null, e.eligibilityScope ?? null);
        }
      }
      for (const r of priorEnhancements) {
        if (!scrapedNames.has(r.name)) deleteOrphanEnhancement.run(r.id);
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
    auto_linked_count,
  };
}

// A chapter pseudo-faction's detachments/enhancements/stratagems aren't
// scraped — Wahapedia has no Chapter dimension to scrape them from (see
// lib/chapters.ts) — they're copied from the already-synced parent
// faction's own rows, filtered by the chapter's hand-curated definition.
// Syncs the parent first if it isn't already.
export async function syncChapter(
  db: Database.Database,
  chapterRow: FactionRow & { chapter_of: string }
): Promise<FactionSyncResult> {
  const chapterDef = findChapter(chapterRow.name);
  if (!chapterDef) throw new Error(`No ChapterDef found for faction "${chapterRow.name}"`);

  let parent = db
    .prepare("SELECT id, name, wahapedia_url, synced_at, army_rule_name, army_rule_text FROM factions WHERE name = ?")
    .get(chapterRow.chapter_of) as
    | (FactionRow & { synced_at: number | null; army_rule_name: string | null; army_rule_text: string | null })
    | undefined;
  if (!parent) throw new Error(`Chapter "${chapterRow.name}": parent faction "${chapterRow.chapter_of}" not found`);
  if (!parent.synced_at) {
    await syncFaction(db, parent);
    parent = db
      .prepare("SELECT id, name, wahapedia_url, synced_at, army_rule_name, army_rule_text FROM factions WHERE id = ?")
      .get(parent.id) as typeof parent;
  }

  type DetachmentRow = { id: number; name: string; dp_cost: number; unique_tag: string | null; force_disposition: string | null; rule_name: string | null; rule_text: string | null };
  type EnhancementRow = { id: number; name: string; points: number; description: string | null; eligibility: string | null; eligibility_scope: string | null };
  type StratagemRow = { name: string; cp: string | null; type: string | null; legend: string | null; when_text: string | null; target_text: string | null; effect_text: string | null; restrictions: string | null };

  const parentDetachments = db.prepare("SELECT * FROM detachments WHERE faction_id = ?").all(parent!.id) as DetachmentRow[];
  const included = parentDetachments.filter(
    (d) => chapterDef.exclusiveDetachmentNames.includes(d.name) || !chapterDef.excludedDetachmentNames.includes(d.name)
  );

  const apply = db.transaction(() => {
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
    const existingEnhancements = db.prepare("SELECT id, name FROM enhancements WHERE detachment_id = ?");
    const updateEnhancement = db.prepare(
      "UPDATE enhancements SET points = ?, description = ?, eligibility = ?, eligibility_scope = ? WHERE id = ?"
    );
    const insertEnhancement = db.prepare(
      "INSERT INTO enhancements (detachment_id, name, points, description, eligibility, eligibility_scope) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const deleteOrphanEnhancement = db.prepare(
      "DELETE FROM enhancements WHERE id = ? AND id NOT IN (SELECT enhancement_id FROM army_units WHERE enhancement_id IS NOT NULL)"
    );
    const deleteDetachmentStratagems = db.prepare("DELETE FROM stratagems WHERE scope = 'detachment' AND detachment_id = ?");
    const insertStratagem = db.prepare(`
      INSERT INTO stratagems (scope, faction_id, detachment_id, name, cp, type, legend, when_text, target_text, effect_text, restrictions)
      VALUES ('detachment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const d of included) {
      upsertDetachment.run(chapterRow.id, d.name, d.dp_cost, d.unique_tag, d.force_disposition, d.rule_name, d.rule_text);
      const detachmentId = (getDetachmentId.get(chapterRow.id, d.name) as { id: number }).id;

      const parentEnhancements = db.prepare("SELECT * FROM enhancements WHERE detachment_id = ?").all(d.id) as EnhancementRow[];
      const priorEnhancements = existingEnhancements.all(detachmentId) as { id: number; name: string }[];
      const enhancementIdByName = new Map(priorEnhancements.map((r) => [r.name, r.id]));
      const copiedNames = new Set<string>();
      for (const e of parentEnhancements) {
        copiedNames.add(e.name);
        const existingId = enhancementIdByName.get(e.name);
        if (existingId != null) {
          updateEnhancement.run(e.points, e.description, e.eligibility, e.eligibility_scope, existingId);
        } else {
          insertEnhancement.run(detachmentId, e.name, e.points, e.description, e.eligibility, e.eligibility_scope);
        }
      }
      for (const r of priorEnhancements) {
        if (!copiedNames.has(r.name)) deleteOrphanEnhancement.run(r.id);
      }

      deleteDetachmentStratagems.run(detachmentId);
      const parentStratagems = db
        .prepare("SELECT name, cp, type, legend, when_text, target_text, effect_text, restrictions FROM stratagems WHERE scope = 'detachment' AND detachment_id = ?")
        .all(d.id) as StratagemRow[];
      for (const s of parentStratagems) {
        insertStratagem.run(chapterRow.id, detachmentId, s.name, s.cp, s.type, s.legend, s.when_text, s.target_text, s.effect_text, s.restrictions);
      }
    }
    // Detachments no longer in the included set are left in place (may still
    // be referenced by an army) — same reasoning as syncFaction.

    db.prepare("UPDATE factions SET synced_at = ?, army_rule_name = ?, army_rule_text = ? WHERE id = ?")
      .run(Date.now(), parent!.army_rule_name, parent!.army_rule_text, chapterRow.id);
  });
  apply();

  const detachment_count = (db.prepare("SELECT COUNT(*) AS n FROM detachments WHERE faction_id = ?").get(chapterRow.id) as { n: number }).n;
  return { detachment_count, core_stratagem_count: 0, auto_linked_count: 0 };
}

// Populate the `factions` table from Wahapedia's faction list so every faction
// is available even before it's synced. Cheap (one CSV fetch); no-op once the
// table is full.
export async function ensureAllFactions(db: Database.Database): Promise<void> {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM factions").get() as { n: number }).n;
  if (count < 20) {
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

  // Chapter pseudo-factions (lib/chapters.ts) aren't in Wahapedia's own
  // faction list at all — self-heal them in here too, on any DB, so a fresh
  // install doesn't need a one-off script.
  const existingNames = new Set(
    (db.prepare("SELECT name FROM factions").all() as { name: string }[]).map((r) => r.name)
  );
  for (const chapter of CHAPTERS) {
    if (existingNames.has(chapter.name)) continue;
    const parent = db.prepare("SELECT wahapedia_url FROM factions WHERE name = ?").get(chapter.parentFactionName) as
      | { wahapedia_url: string }
      | undefined;
    if (!parent) continue; // parent not synced into `factions` yet — retried next call
    db.prepare("INSERT INTO factions (name, wahapedia_url, chapter_of) VALUES (?, ?, ?)").run(
      chapter.name,
      parent.wahapedia_url,
      chapter.parentFactionName
    );
  }
}

// Refresh the global core-stratagem rows once per process. Core stratagems only
// change with a rules update, but a deploy that fixes the scrape (e.g. dropping
// removed 10th-ed entries) needs a way to correct DBs whose factions were all
// synced by the old code. Runs on the first /api/stratagems hit after startup.
let coreDone = false;
let coreInFlight: Promise<void> | null = null;

export function ensureCoreStratagems(db: Database.Database): Promise<void> {
  if (coreDone) return Promise.resolve();
  if (coreInFlight) return coreInFlight;
  coreInFlight = (async () => {
    try {
      const strats = await scrapeWahapediaCoreStratagems();
      if (strats.length > 0) {
        const write = db.transaction(() => {
          db.prepare("DELETE FROM stratagems WHERE scope = 'core'").run();
          const ins = db.prepare(`
            INSERT INTO stratagems (scope, faction_id, detachment_id, name, cp, type, legend, when_text, target_text, effect_text, restrictions)
            VALUES ('core', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const s of strats) {
            ins.run(s.name, s.cp, s.type, s.legend, s.when, s.target, s.effect, s.restrictions ?? null);
          }
        });
        write();
      }
      coreDone = true;
    } catch (err) {
      console.error("ensureCoreStratagems failed:", err);
    } finally {
      coreInFlight = null;
    }
  })();
  return coreInFlight;
}

// Concurrent /api/detachments + /api/stratagems requests for the same faction
// should only kick off one sync.
const inFlight = new Map<number, Promise<void>>();

export async function ensureFactionSynced(db: Database.Database, factionId: number): Promise<void> {
  if (!Number.isFinite(factionId)) return;
  const row = db.prepare("SELECT id, name, wahapedia_url, synced_at, chapter_of FROM factions WHERE id = ?").get(factionId) as
    | (FactionRow & { synced_at: number | null; chapter_of: string | null })
    | undefined;
  if (!row || row.synced_at) return;

  const running = inFlight.get(factionId);
  if (running) return running;

  const p = (async () => {
    try {
      if (row.chapter_of) await syncChapter(db, row as FactionRow & { chapter_of: string });
      else await syncFaction(db, row);
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

  const factions = db.prepare("SELECT id, name, wahapedia_url, chapter_of FROM factions ORDER BY name ASC").all() as
    (FactionRow & { chapter_of: string | null })[];
  let synced = 0;
  let failed = 0;

  for (let i = 0; i < factions.length; i++) {
    const f = factions[i];
    try {
      // syncChapter syncs its parent first if needed, so ordering here
      // (alphabetical by name) doesn't matter even though a chapter can
      // sort before its own parent faction (e.g. "Dark Angels" before
      // "Space Marines").
      const r = f.chapter_of
        ? await syncChapter(db, f as FactionRow & { chapter_of: string })
        : await syncFaction(db, f, { coreStratagems, csvs });
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
