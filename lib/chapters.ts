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
// Verified 2026-10-11 directly against the Space Marines page's own chapter
// filter widget (the `.DetFilterItem[data-f="CH:..."]` bitmask on each
// detachment heading) — a canonical source, not inferred from rule text.
// An earlier pass of this file was built by reading each detachment's own
// rule text for a restriction clause, which undercounted: several
// chapter-exclusive detachments (Medusa's Wrath, Shadowmark Talon, Champions
// of Fenris, Saga of the Beastslayer, and — once the scraper's
// multi-Force-Disposition header bug is fixed — Angelic Inheritors, Blade of
// Ultramar, Black Spear Task Force) don't phrase their restriction the same
// way and were wrongly left off `excludedDetachmentNames`, leaking into
// every chapter's detachment list including Dark Angels'. "Deathwatch
// Support" looks chapter-locked by name but its own CH bitmask covers every
// chapter — it's genuinely available army-wide, not excluded here.
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
      "Medusa's Wrath", // Iron Hands
      "Shadowmark Talon", // Raven Guard
      "Forgefather’s Seekers", // Salamanders
      "Spearpoint Task Force", // White Scars
      "Fist of the God-Emperor", // Black Templars
      "Marshal’s Household", // Black Templars
      "Vow-sworn Crusaders", // Black Templars
      "Angelic Inheritors", // Blood Angels
      "Encarmine Speartip", // Blood Angels
      "Wrath of the Doomed", // Blood Angels
      "Saga of the Great Wolf", // Space Wolves
      "Champions of Fenris", // Space Wolves
      "Saga of the Beastslayer", // Space Wolves
      "Blade of Ultramar", // Ultramarines
      "Black Spear Task Force", // Deathwatch
    ],
  },
];

export function findChapter(name: string): ChapterDef | undefined {
  return CHAPTERS.find((c) => c.name === name);
}
