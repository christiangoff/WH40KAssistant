// ─────────────────────────────────────────────────────────────────────────
// Space Marine Chapters as selectable pseudo-factions.
//
// Wahapedia (and GW's own data exports) have no Chapter dimension at all:
// every Space Marine Chapter lives under one "Space Marines" faction, and
// Chapter is, at most, a unit-level publication tag (Datasheets.csv's
// `source`) — never present on detachments, stratagems, or enhancements.
// There's nothing to scrape or filter on programmatically, so this is a
// small, hand-curated, verified-against-live-data mapping rather than
// something derived automatically — see lib/factionSync.ts's chapter sync
// branch for how it's applied (parent faction synced normally, then this
// chapter's own `detachments`/`enhancements`/`stratagems` rows are copied
// from the parent's, filtered by this definition).
//
// Verified directly against Wahapedia (2026-10-10): every Space Marines
// detachment whose own scraped rule text contains a restriction clause
// ("Your army can include <Chapter> units, but it cannot include any
// ADEPTUS ASTARTES units drawn from any other Chapter") is either exclusive
// to this chapter (include unconditionally) or exclusive to a *different*
// chapter (exclude). Everything else carries no such restriction and is
// available to every Chapter, Dark Angels included — a couple of those
// (e.g. "Champions of Fenris") are Space-Wolves-*flavored* but not actually
// chapter-locked in the real rule text; legal to pick, just not useful
// without Space Wolves units, which is a correct reflection of the rules,
// not something to paper over.
// ─────────────────────────────────────────────────────────────────────────

export interface ChapterDef {
  /** The chapter's own faction name, e.g. "Dark Angels". */
  name: string;
  /** The real faction this chapter's data is drawn from, e.g. "Space Marines". */
  parentFactionName: string;
  /** catalog_units.source values exclusive to this chapter — always included. */
  exclusiveUnitSources: string[];
  /** Detachment names exclusive to this chapter — always included regardless
   *  of the generic/excluded lists below. */
  exclusiveDetachmentNames: string[];
  /** Detachment names locked to a *different* chapter — excluded even though
   *  they belong to the same parent faction. Every other parent detachment
   *  (no restriction at all) is included by default. */
  excludedDetachmentNames: string[];
}

export const CHAPTERS: ChapterDef[] = [
  {
    name: "Dark Angels",
    parentFactionName: "Space Marines",
    exclusiveUnitSources: ["Dark Angels"],
    exclusiveDetachmentNames: ["Darkflight Pursuit", "Inner Circle Task Force", "Wrath of the Rock"],
    excludedDetachmentNames: [
      "Ceramite Sentinels", // Imperial Fists
      "Forgefather’s Seekers", // Salamanders
      "Spearpoint Task Force", // White Scars
      "Fist of the God-Emperor", // Black Templars
      "Marshal’s Household", // Black Templars
      "Vow-sworn Crusaders", // Black Templars
      "Encarmine Speartip", // Blood Angels
      "Wrath of the Doomed", // Blood Angels
      "Saga of the Great Wolf", // Space Wolves
    ],
  },
];

export function findChapter(name: string): ChapterDef | undefined {
  return CHAPTERS.find((c) => c.name === name);
}
