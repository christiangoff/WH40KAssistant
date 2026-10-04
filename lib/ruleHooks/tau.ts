import type { AttackContext } from "@/lib/battleSim";
import type { SpatialUnit } from "@/lib/battleSimSpatial";
import type { HookCtx, RuleHooks, StratagemOffer, StratagemWindow } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// T'au Empire — the Phase 1 vertical slice. Implemented against the exact
// text scraped into `factions.army_rule_text` / `detachments.rule_text` /
// `stratagems.effect_text` this session (lib/factionSync.ts), not from
// memory. Verbatim source (T'au Empire faction page + Kauyon detachment,
// synced 2026-09-29):
//
// FOR THE GREATER GOOD (army rule) — "If your Army Faction is T'AU EMPIRE,
// at the start of your Shooting phase you can select units from your army
// with this ability to become Observer units. During your Shooting phase,
// for each Observer unit from your army that has not been selected to
// shoot this phase and is eligible to shoot (excluding FORTIFICATION and
// Battle-shocked units) select one enemy unit that is visible to be marked
// as their Spotted unit until the end of the phase. [...] Units [...] are
// Guided units while targeting one or more Spotted units. [...] each time a
// model [...] in a Guided unit makes an attack that targets a Spotted unit,
// improve the Ballistic Skill characteristic of that attack by 1 and, if
// the Spotted unit was marked by an Observer unit that has the MARKERLIGHT
// keyword, that attack has the [IGNORES COVER] ability."
//
// PATIENT HUNTER (Kauyon detachment rule) — "During the third, fourth and
// fifth battle rounds, ranged weapons equipped by T'au Empire models from
// your army have the [SUSTAINED HITS 1] ability. During the third, fourth
// and fifth battle rounds, while a unit is a Guided unit [...] each time a
// ranged attack is made by a model in that unit that targets a Spotted
// unit, you can ignore any or all modifiers to that attack's Ballistic
// skill characteristics and/or all modifiers to the Hit roll."
//
// Simplifications, disclosed: [IGNORES COVER] has no functional effect —
// this engine has no terrain/cover model. Observer selection and phase-wide
// spotting are resolved as one up-front pass at the start of the Shooting
// step (see onShootingPhaseStart) rather than interleaved with the order
// units are chosen to shoot, because the board UI already collects a whole
// phase's orders in one batch before submitting — see lib/battleSimSpatial.ts.
// Kauyon's 6 detachment stratagems are NOT implemented except Point-Blank
// Ambush (below); the other 5 and all 10 core stratagems are a follow-up
// slice, not silently approximated.
// ─────────────────────────────────────────────────────────────────────────

interface TauScratch {
  round: number;
  side: "a" | "b";
  /** Enemy armyUnitIds marked Spotted this phase. */
  spotted: number[];
  /** Own armyUnitIds that became Observers this phase (can't also shoot). */
  observers: number[];
}

function scratchFor(ctx: HookCtx): TauScratch {
  const bag = (ctx.state.hookScratch ??= {});
  const existing = bag.tau as TauScratch | undefined;
  if (existing && existing.round === ctx.state.round && existing.side === ctx.side) return existing;
  const fresh: TauScratch = { round: ctx.state.round, side: ctx.side, spotted: [], observers: [] };
  bag.tau = fresh;
  return fresh;
}

function isEligibleObserver(u: SpatialUnit): boolean {
  if (u.battleShocked || u.destroyed) return false;
  if (u.stats.keywords.some((k) => /fortification/i.test(k))) return false;
  return u.stats.keywords.some((k) => /t.au empire/i.test(k));
}

export const FOR_THE_GREATER_GOOD: RuleHooks = {
  key: "for-the-greater-good",
  label: "For the Greater Good",

  spotEligible(_ctx, unit) {
    return isEligibleObserver(unit);
  },

  onShootingPhaseStart(ctx, decisions, log) {
    const scratch = scratchFor(ctx);
    const units = ctx.side === "a" ? ctx.state.unitsA : ctx.state.unitsB;
    for (const u of units) {
      if (!isEligibleObserver(u)) continue;
      const choice = decisions?.[String(u.armyUnitId)];
      if (!choice || !choice.startsWith("spot:")) continue;
      const targetId = parseInt(choice.slice("spot:".length), 10);
      const enemies = ctx.side === "a" ? ctx.state.unitsB : ctx.state.unitsA;
      const target = enemies.find((e) => e.armyUnitId === targetId && !e.destroyed);
      if (!target) continue;
      if (!scratch.observers.includes(u.armyUnitId)) scratch.observers.push(u.armyUnitId);
      if (!scratch.spotted.includes(target.armyUnitId)) scratch.spotted.push(target.armyUnitId);
      log(`${u.name} spots ${target.name} for the greater good — Spotted until end of phase.`);
    }
  },

  modifyAttackContext(ctx, attacker, defender, base) {
    const scratch = scratchFor(ctx);
    if (scratch.observers.includes(attacker.armyUnitId)) return base; // Observers don't also shoot
    if (!scratch.spotted.includes(defender.armyUnitId)) return base;
    return { ...base, hitBonus: (base.hitBonus ?? 0) + 1 };
  },
};

const KAUYON_ACTIVE_ROUNDS = [3, 4, 5];

export const KAUYON: RuleHooks = {
  key: "kauyon",
  label: "Kauyon — Patient Hunter",

  modifyAttackContext(ctx, attacker, defender, base) {
    if (!KAUYON_ACTIVE_ROUNDS.includes(ctx.state.round)) return base;
    let patched: AttackContext = {
      ...base,
      forcedKeywords: [...(base.forcedKeywords ?? []), { kind: "sustained-hits", bonus: 1 }],
    };
    const scratch = (ctx.state.hookScratch?.tau) as TauScratch | undefined;
    if (scratch?.spotted.includes(defender.armyUnitId)) {
      patched = { ...patched, ignoreHitPenalty: true };
    }
    return patched;
  },

  offerStratagems(ctx, window: StratagemWindow, unit: SpatialUnit): StratagemOffer[] {
    if (window !== "pre-shoot") return [];
    if (!KAUYON_ACTIVE_ROUNDS.includes(ctx.state.round)) return [];
    const cpAvailable = ctx.side === "a" ? ctx.state.cpA : ctx.state.cpB;
    if (cpAvailable < 1) return [];
    return [
      {
        key: `point-blank-ambush:${unit.armyUnitId}`,
        name: "Point-Blank Ambush",
        cp: 1,
        description: "+1 Armour Penetration for this unit's ranged attacks against targets within 9\" this phase.",
      },
    ];
  },

  applyStratagem(_ctx, offerKey) {
    if (!offerKey.startsWith("point-blank-ambush:")) return;
    return { apBonus: 1 };
  },
};
