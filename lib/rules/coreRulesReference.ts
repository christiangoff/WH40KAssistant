// ─────────────────────────────────────────────────────────────────────────
// A small, hand-curated reference of real 40k rules text, used for in-app
// tooltips on the battle board (hover a phase/step/keyword → what it
// actually says) and as the implementation spec for lib/ruleKeywords.ts and
// lib/ruleHooks/. Static and checked in, not scraped at runtime: Wahapedia's
// core-rules page (wahapedia.ru/wh40k11ed/the-rules/core-rules/) has real,
// structured section anchors matching the current 11th-edition phase
// sequence (confirmed working this session — e.g. Battle-shock-Rolls
// extracts cleanly), but its markup nests rule text inside broad container
// divs shared with unrelated sections, so a naive selector-based scrape
// pulls in far more surrounding page content than the target rule (verified
// firsthand attempting a #What-Is-Coherency extraction). A hand-curated
// file sourced directly from the site is more honest than a scraper that
// might silently grab the wrong text, and this reference only needs to
// cover the handful of things the engine actually surfaces — not the whole
// rulebook.
//
// Detachment/army-rule/stratagem text is NOT duplicated here — that's
// already scraped verbatim into the `detachments`/`stratagems` tables by
// lib/factionSync.ts, which is the actual source of truth those rows use
// (and what lib/ruleHooks/tau.ts was implemented against). This file is
// only for the generic core-rules concepts the keyword engine depends on.
// ─────────────────────────────────────────────────────────────────────────

export interface RuleRefEntry {
  title: string;
  /** Anchor on wahapedia.ru/wh40k11ed/the-rules/core-rules/ or /rules-appendix/, for a "view source" link. */
  sourceAnchor: string;
  text: string;
}

export const PHASE_SEQUENCE: RuleRefEntry[] = [
  {
    title: "Command Phase",
    sourceAnchor: "Command-Phase",
    text: "Start of Command Phase → Gain Core CP → Battle-shock step → Command Abilities → End of Command Phase.",
  },
  {
    title: "Battle-shock Rolls",
    sourceAnchor: "Battle-shock-Rolls",
    text: "Each player checks their army for any Battle-shocked units. Then, for each unit from their army that is below its Starting Strength, that player makes a battle-shock roll (2D6, needs to beat the unit's Leadership). If that roll succeeds, that unit does not become battle-shocked. If that roll fails, that unit, and each model in it, is battle-shocked.",
  },
  {
    title: "Movement Phase",
    sourceAnchor: "Movement-Phase",
    text: "Start of Movement Phase → Move Units step (each unit either stays stationary, or makes one Normal, Advance, Fall Back, or Remain Stationary move) → End of Movement Phase.",
  },
  {
    title: "Shooting Phase",
    sourceAnchor: "Shooting-Phase",
    text: "Start of Shooting Phase → Shoot step (select a unit to shoot, select its ranged weapons, select targets, then resolve the Attack Sequence for each) → End of Shooting Phase.",
  },
  {
    title: "Charge Phase",
    sourceAnchor: "Charge-Phase",
    text: "Start of Charge Phase → Charge step (declare a charge against one or more visible enemy units within 12\", make a Charge move using a 2D6\" Charge roll — the unit must end within Engagement Range of every unit it charged and no closer than Engagement Range to any unit it didn't) → End of Charge Phase.",
  },
  {
    title: "Fight Phase",
    sourceAnchor: "Fight-Phase",
    text: "Start of Fight Phase → Fight step, resolved in this order: units that charged this turn / units with FIGHTS FIRST / all other eligible units, alternating between players → each selected unit Pile-Ins (up to 3\"), fights with its melee weapons, then Consolidates (up to 3\") → End of Fight Phase.",
  },
  {
    title: "Attack Sequence",
    sourceAnchor: "Attack-Sequence",
    text: "1. Hit Roll → 2. Wound Roll → 3. Saving Throw → 4. Inflict Damage, resolved one weapon at a time against one target.",
  },
  {
    title: "Critical Hits and Critical Wounds",
    sourceAnchor: "Critical-Hits-and-Critical-Wounds",
    text: "Critical hits are still hits, and critical wounds are still wounds. In addition, other rules can be triggered by a critical hit or a critical wound, such as [LETHAL HITS] and [DEVASTATING WOUNDS]. Unless specified otherwise, an unmodified Hit roll of 6 is always a Critical Hit, and an unmodified Wound roll of 6 is always a Critical Wound.",
  },
  {
    title: "Coherency",
    sourceAnchor: "What-Is-Coherency",
    text: "Every model in a unit must be within Unit Coherency: for units of 6 or more models, within 2\" horizontally of at least two other models from their unit; for units of 5 or fewer, within 2\" of at least one other model from their unit.",
  },
  {
    title: "Engagement Range",
    sourceAnchor: "Engagement",
    text: "A unit is within Engagement Range of an enemy unit if any model in it is within 1\" horizontally, and within 5\" vertically, of any model in that enemy unit.",
  },
];

/** Keyword glossary — the engine's own weapon-keyword mechanics (see
 *  lib/ruleKeywords.ts), phrased as short rule summaries for tooltips. */
export const KEYWORD_REFERENCE: RuleRefEntry[] = [
  { title: "Lethal Hits", sourceAnchor: "Core-Abilities", text: "A Critical Hit scored by this weapon automatically wounds the target — no Wound roll is made for that hit." },
  { title: "Sustained Hits X", sourceAnchor: "Core-Abilities", text: "Each Critical Hit scored by this weapon scores X additional hits on the target, on top of the hit that triggered it." },
  { title: "Devastating Wounds", sourceAnchor: "Precision-and-Devastating-Wounds", text: "Each Critical Wound scored by this weapon is allocated as damage directly — no saving throw of any kind can be made against it." },
  { title: "Anti-X Y+", sourceAnchor: "Core-Abilities", text: "This weapon's attacks score a Critical Wound against a unit with keyword X on an unmodified Wound roll of Y or more, instead of only on a natural 6." },
  { title: "Twin-linked", sourceAnchor: "Core-Abilities", text: "You can re-roll the Wound roll for this weapon's attacks." },
  { title: "Heavy", sourceAnchor: "Core-Abilities", text: "Add 1 to the Hit roll for this weapon's attacks if the bearer's unit remained stationary during the Move Units step this turn." },
  { title: "Rapid Fire X", sourceAnchor: "Core-Abilities", text: "Add X to this weapon's Attacks characteristic when targeting a unit within half the weapon's range." },
  { title: "Torrent", sourceAnchor: "[TORRENT]", text: "This weapon's attacks automatically hit the target — no Hit roll is made." },
  { title: "Melta X", sourceAnchor: "Core-Abilities", text: "Add X to this weapon's Damage characteristic when targeting a unit within half the weapon's range." },
  { title: "Blast", sourceAnchor: "Core-Abilities", text: "Add 1 to this weapon's Attacks characteristic for every full 5 models in the target unit." },
  { title: "Hazardous", sourceAnchor: "Hazard-Rolls", text: "After this unit finishes making attacks with this weapon, roll one D6 per model that attacked with it (a Hazard roll): on an unmodified 1, that model's unit suffers 1 mortal wound." },
  { title: "One Shot", sourceAnchor: "[ONE-SHOT]", text: "This weapon can only be selected to shoot with once per battle." },
];
