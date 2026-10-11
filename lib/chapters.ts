// ─────────────────────────────────────────────────────────────────────────
// Space Marine Chapters.
//
// A Chapter is an attribute of a Space Marines army, not a faction of its
// own — Wahapedia has no Chapter dimension on detachments/stratagems/
// enhancements at all, only a unit-level publication tag
// (`catalog_units.source`, see app/collection/page.tsx's Chapter filter,
// which reads that column directly and needs nothing from this file).
//
// An earlier version of this feature modeled each Chapter as its own
// synthetic `factions` row with a copied-and-filtered set of detachments.
// That shape needed a full include/exclude list *per chapter*, which had
// to be kept in sync across every other chapter by hand — a structural
// trap that caused real bugs (missing exclusions; an admin resync path
// that bypassed filtering entirely). This flat map has exactly one fact
// per chapter-locked detachment, so there's nothing to keep in sync.
//
// Verified 2026-10-11 directly against the Space Marines page's own
// chapter filter widget (the `.DetFilterItem[data-f="CH:..."]` bitmask on
// each detachment heading) — a canonical source, not inferred from rule
// text (an earlier pass of this data was built that way and undercounted).
// ─────────────────────────────────────────────────────────────────────────

/** Detachment name -> the one Chapter (or Deathwatch) it's exclusive to.
 *  Absent from this map = generic, available to any Chapter or no Chapter
 *  at all. */
export const CHAPTER_EXCLUSIVE_DETACHMENTS: Record<string, string> = {
  "Darkflight Pursuit": "Dark Angels",
  "Inner Circle Task Force": "Dark Angels",
  "Wrath of the Rock": "Dark Angels",
  "Vow-sworn Crusaders": "Black Templars",
  "Marshal’s Household": "Black Templars",
  "Fist of the God-Emperor": "Black Templars",
  "Angelic Inheritors": "Blood Angels",
  "Encarmine Speartip": "Blood Angels",
  "Wrath of the Doomed": "Blood Angels",
  "Black Spear Task Force": "Deathwatch",
  "Medusa's Wrath": "Iron Hands",
  "Ceramite Sentinels": "Imperial Fists",
  "Shadowmark Talon": "Raven Guard",
  "Forgefather’s Seekers": "Salamanders",
  "Saga of the Great Wolf": "Space Wolves",
  "Champions of Fenris": "Space Wolves",
  "Saga of the Beastslayer": "Space Wolves",
  "Blade of Ultramar": "Ultramarines",
  "Spearpoint Task Force": "White Scars",
};

/** Which faction shows a Chapter selector, and what the options are.
 *  Deathwatch isn't literally a Chapter but owns one exclusive detachment
 *  (Black Spear Task Force) the same way a Chapter does, so it's listed
 *  here too rather than leaving that detachment permanently unreachable. */
export const CHAPTERS_BY_FACTION: Record<string, string[]> = {
  "Space Marines": [
    "Black Templars",
    "Blood Angels",
    "Dark Angels",
    "Deathwatch",
    "Imperial Fists",
    "Iron Hands",
    "Raven Guard",
    "Salamanders",
    "Space Wolves",
    "Ultramarines",
    "White Scars",
  ],
};

export function chaptersForFaction(factionName: string | null | undefined): string[] {
  return (factionName && CHAPTERS_BY_FACTION[factionName]) || [];
}
