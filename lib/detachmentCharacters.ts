// ─────────────────────────────────────────────────────────────────────────
// A small number of detachments let you promote specific units to CHARACTER
// at list-building time (so they can take Enhancements), rather than the
// unit's own datasheet carrying CHARACTER. Same hand-curated pattern as the
// allied-Knights/Daemonic-Pact rules in lib/allies.ts — verified static
// data over fragile rule-text parsing.
//
// Headhunter Task Force (Space Marines — "Armageddon: The Return of
// Yarrick", Apr 2026) verified directly against the live rule_text already
// scraped into this app:
//   "Adeptus Astartes Vehicle units from your army (excluding
//   Fortifications, Drop Pods, Walkers and units that can Fly) have the
//   TANK ACE keyword. In the Muster Armies step, you can select up to
//   three TANK ACE units from your army to gain the CHARACTER keyword."
// Drop Pod has no "DROP POD" keyword (its real keywords are VEHICLE,
// DEDICATED TRANSPORT, FRAME, IMPERIUM, TRANSPORT — verified live), so
// that one exclusion has to be name-based rather than keyword-based.
// ─────────────────────────────────────────────────────────────────────────

export interface DetachmentCharacterRule {
  /** The detachment that grants this — must match detachments.name exactly. */
  detachmentName: string;
  /** How many units across the army can be promoted at once. */
  maxUnits: number;
  /** The keyword the rule grants before CHARACTER — shown in the toggle's tooltip only. */
  grantedKeywordLabel: string;
  /** A unit must have every one of these keywords to be eligible. */
  requiredKeywords: string[];
  /** A unit with any of these keywords is never eligible. */
  excludedKeywords: string[];
  /** A unit with any of these exact names (case-insensitive) is never eligible. */
  excludedNames: string[];
}

export const DETACHMENT_CHARACTER_RULES: DetachmentCharacterRule[] = [
  {
    detachmentName: "Headhunter Task Force",
    maxUnits: 3,
    grantedKeywordLabel: "TANK ACE",
    requiredKeywords: ["ADEPTUS ASTARTES", "VEHICLE"],
    excludedKeywords: ["FORTIFICATION", "WALKER", "FLY"],
    excludedNames: ["Drop Pod"],
  },
];

export function findDetachmentCharacterRule(detachmentNames: string[]): DetachmentCharacterRule | undefined {
  return DETACHMENT_CHARACTER_RULES.find((r) => detachmentNames.includes(r.detachmentName));
}

export function unitQualifiesForDetachmentCharacter(
  rule: DetachmentCharacterRule,
  unitName: string,
  keywords: string[]
): boolean {
  const kw = new Set(keywords.map((k) => k.toUpperCase()));
  if (!rule.requiredKeywords.every((k) => kw.has(k))) return false;
  if (rule.excludedKeywords.some((k) => kw.has(k))) return false;
  if (rule.excludedNames.some((n) => n.toLowerCase() === unitName.toLowerCase())) return false;
  return true;
}
