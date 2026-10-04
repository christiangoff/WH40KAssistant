// ─────────────────────────────────────────────────────────────────────────
// Generic weapon-keyword engine — parses the standard core-rule ability
// keywords off a weapon's scraped `abilities` string (e.g. "MELTA 2,
// TWIN-LINKED") and exposes them as structured data that lib/battleSim.ts's
// resolveAttacks() wires into hit/wound/save/damage resolution.
//
// Unlike detachment rules and stratagems (bespoke prose per faction), these
// keywords are a small, fixed, well-known vocabulary defined once in the
// core rules and used identically by every faction — so a generic parser +
// effect engine here lifts combat accuracy for every army in the game, not
// just the T'au rule-hook slice (lib/ruleHooks/).
//
// Mechanics implemented from the current (10th/11th edition) core-rules
// wording for each keyword, cross-checked against Wahapedia's core-rules and
// rules-appendix pages this session (e.g. "Critical hits are still hits, and
// critical wounds are still wounds. In addition, other rules can be
// triggered by a critical hit or a critical wound, such as [LETHAL HITS] and
// [DEVASTATING WOUNDS]" — core-rules #Critical-Hits-and-Critical-Wounds).
// Kept deliberately narrow: keywords that need terrain/line-of-sight/
// character-targeting the engine doesn't model (Ignores Cover, Indirect
// Fire, Precision) or that don't affect resolution given how the engine
// already handles phases (Pistol, Assault, Extra Attacks) are intentionally
// not implemented — see the comment on `parseWeaponKeywords` below.
// ─────────────────────────────────────────────────────────────────────────

export type WeaponKeyword =
  | { kind: "lethal-hits" }
  | { kind: "sustained-hits"; bonus: number }
  | { kind: "devastating-wounds" }
  | { kind: "anti"; keyword: string; threshold: number }
  | { kind: "twin-linked" }
  | { kind: "heavy" }
  | { kind: "rapid-fire"; bonus: number }
  | { kind: "torrent" }
  | { kind: "melta"; bonus: number }
  | { kind: "blast" }
  | { kind: "hazardous" }
  | { kind: "one-shot" };

/**
 * Extracts the subset of standard core-rule weapon keywords this engine
 * actually implements. Not implemented (no functional effect in this
 * engine, because the thing they modify isn't modeled): IGNORES COVER,
 * INDIRECT FIRE (no terrain/LOS), PRECISION (no independent-character
 * targeting), PISTOL, ASSAULT (no Advance move), EXTRA ATTACKS (no
 * multi-weapon-per-model attack stacking beyond what's already summed).
 */
export function parseWeaponKeywords(abilities: string | undefined | null): WeaponKeyword[] {
  const text = abilities ?? "";
  const out: WeaponKeyword[] = [];

  if (/\blethal hits\b/i.test(text)) out.push({ kind: "lethal-hits" });

  const sustained = text.match(/sustained hits\s*(\d+)/i);
  if (sustained) out.push({ kind: "sustained-hits", bonus: parseInt(sustained[1], 10) });

  if (/\bdevastating wounds\b/i.test(text)) out.push({ kind: "devastating-wounds" });

  for (const m of text.matchAll(/anti-([a-z][a-z\s]*?)\s+(\d)\+/gi)) {
    out.push({ kind: "anti", keyword: m[1].trim().toUpperCase(), threshold: parseInt(m[2], 10) });
  }

  if (/\btwin-linked\b/i.test(text)) out.push({ kind: "twin-linked" });

  if (/\bheavy\b/i.test(text)) out.push({ kind: "heavy" });

  const rapidFire = text.match(/rapid fire\s*(\d+)/i);
  if (rapidFire) out.push({ kind: "rapid-fire", bonus: parseInt(rapidFire[1], 10) });

  if (/\btorrent\b/i.test(text)) out.push({ kind: "torrent" });

  const melta = text.match(/\bmelta\s*(\d+)/i);
  if (melta) out.push({ kind: "melta", bonus: parseInt(melta[1], 10) });

  if (/\bblast\b/i.test(text)) out.push({ kind: "blast" });

  if (/\bhazardous\b/i.test(text)) out.push({ kind: "hazardous" });

  if (/\bone shot\b/i.test(text)) out.push({ kind: "one-shot" });

  return out;
}

export function hasKeyword(keywords: WeaponKeyword[], kind: WeaponKeyword["kind"]): boolean {
  return keywords.some((k) => k.kind === kind);
}
