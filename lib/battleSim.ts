import type Database from "better-sqlite3";
import type { UnitStats, WeaponProfile } from "@/lib/wahapedia";
import { allocateModelProfiles } from "@/lib/wahapedia";
import { parseWeaponKeywords, hasKeyword, type WeaponKeyword } from "@/lib/ruleKeywords";

// ─────────────────────────────────────────────────────────────────────────
// Battle simulator — an approximation, not a rules-accurate engine.
//
// This auto-plays a full battle between two armies using each unit's real
// stat line, real weapons, and real dice (hit/wound/save/damage all follow
// the standard 40k tables), but position is abstracted into five zones
// instead of literal inches/line-of-sight. resolveAttacks() DOES execute the
// standard core-rule weapon-ability keywords (Lethal/Sustained Hits,
// Devastating Wounds, Anti-X, Twin-linked, Heavy, Rapid Fire, Melta, Blast,
// Torrent, Hazardous, One Shot — see lib/ruleKeywords.ts) since those are a
// small fixed vocabulary shared by every faction, but detachment rules and
// stratagems are still NOT executed mechanically here — those are bespoke
// per-faction prose; see lib/ruleHooks/ for the opt-in, hand-implemented
// exceptions (currently: T'au's For the Greater Good + Kauyon, wired into
// lib/battleSimSpatial.ts only). Battle-shock and movement are simplified
// house rules loosely inspired by the core rules, not a verified
// transcription of them. Treat results as "a plausible game," not an
// official ruling.
// ─────────────────────────────────────────────────────────────────────────

export type Zone = "A_DEPLOY" | "A_FIELD" | "MID" | "B_FIELD" | "B_DEPLOY";
export const ZONE_ORDER: Zone[] = ["A_DEPLOY", "A_FIELD", "MID", "B_FIELD", "B_DEPLOY"];

export interface SimMission {
  key: string;
  name: string;
  description: string;
  /** Which zones hold a scorable objective, and how many VP it's worth each time it's scored. */
  objectives: { zone: Zone; vp: number }[];
  /** Battle rounds objectives are scored on (1-based). */
  scoringRounds: number[];
}

// Original, simplified mission set — not a transcription of any official
// Games Workshop mission pack.
export const MISSIONS: SimMission[] = [
  {
    key: "scorched-earth",
    name: "Scorched Earth",
    description: "Three objectives — the field, the middle, and the field again. Hold ground, score every round from the second on.",
    objectives: [
      { zone: "A_FIELD", vp: 5 },
      { zone: "MID", vp: 5 },
      { zone: "B_FIELD", vp: 5 },
    ],
    scoringRounds: [2, 3, 4, 5],
  },
  {
    key: "vantage-points",
    name: "Vantage Points",
    description: "The middle objective is worth double — a chokepoint worth fighting over. Scores only on the big turns.",
    objectives: [
      { zone: "A_FIELD", vp: 5 },
      { zone: "MID", vp: 10 },
      { zone: "B_FIELD", vp: 5 },
    ],
    scoringRounds: [2, 4, 5],
  },
  {
    key: "encirclement",
    name: "Encirclement",
    description: "Five objectives, including both deployment zones — a faster, more volatile fight that scores from turn one.",
    objectives: [
      { zone: "A_DEPLOY", vp: 3 },
      { zone: "A_FIELD", vp: 4 },
      { zone: "MID", vp: 4 },
      { zone: "B_FIELD", vp: 4 },
      { zone: "B_DEPLOY", vp: 3 },
    ],
    scoringRounds: [1, 2, 3, 4, 5],
  },
];

// ─── Dice ───────────────────────────────────────────────────────────────

function d6(): number {
  return 1 + Math.floor(Math.random() * 6);
}

export function roll2d6(): number {
  return d6() + d6();
}

/** Parses a stat/weapon field like "D6", "2D6+3", "D3", "5" into a rolled total. "-" / "" -> 0. */
export function rollExpr(expr: string | undefined | null): number {
  const e = (expr ?? "").trim().toUpperCase();
  if (!e || e === "-" || e === "N/A") return 0;
  const m = e.match(/^(\d*)D(\d+)(?:\s*\+\s*(\d+))?$/);
  if (m) {
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const die = parseInt(m[2], 10);
    const bonus = m[3] ? parseInt(m[3], 10) : 0;
    let total = bonus;
    for (let i = 0; i < count; i++) total += 1 + Math.floor(Math.random() * die);
    return total;
  }
  const n = parseInt(e, 10);
  return Number.isFinite(n) ? n : 1;
}

/** "3+" -> 3, "-" -> null (no roll needed / auto-fail context-dependent). */
export function parseTarget(s: string | undefined | null): number | null {
  const m = (s ?? "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export function parseInt0(s: string | undefined | null): number {
  const m = (s ?? "").match(/-?\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

// Re-exported for convenience — actually defined in lib/battleBoard.ts,
// which has zero imports so the battle simulator's board (a client
// component) can use it directly without pulling this module's runtime
// dependency on the scraper (lib/wahapedia.ts) into the browser bundle.
export { parseBaseSize, type BaseSize } from "./battleBoard";

// Standard 40k wound table.
function woundTarget(strength: number, toughness: number): number {
  if (toughness <= 0) return 2;
  if (strength >= toughness * 2) return 2;
  if (strength > toughness) return 3;
  if (strength === toughness) return 4;
  if (strength * 2 <= toughness) return 6;
  return 5;
}

// ─── Roster ─────────────────────────────────────────────────────────────

export interface SimModel {
  maxWounds: number;
  curWounds: number;
}

export interface SimUnit {
  armyUnitId: number;
  name: string;
  side: "a" | "b";
  stats: UnitStats;
  weapons: WeaponProfile[];
  models: SimModel[];
  oc: number;
  zone: Zone;
  battleShocked: boolean;
  engaged: boolean;
  destroyed: boolean;
  startingModelCount: number;
  firedOneShot: string[];
}

interface RosterRow {
  id: number;
  unit_id: number;
  name: string;
  model_count: number;
  selected_weapons: string | null;
  stats_json: string | null;
}

export function loadRoster(db: Database.Database, armyId: number, side: "a" | "b", deployZone: Zone): SimUnit[] {
  const rows = db
    .prepare(
      `SELECT au.id, au.unit_id, u.name, au.model_count, au.selected_weapons, u.stats_json
       FROM army_units au JOIN units u ON u.id = au.unit_id
       WHERE au.army_id = ? ORDER BY au.id ASC`
    )
    .all(armyId) as RosterRow[];

  const units: SimUnit[] = [];
  for (const r of rows) {
    if (!r.stats_json) continue;
    const stats: UnitStats = JSON.parse(r.stats_json);

    let selectedNames: Set<string> | null = null;
    if (r.selected_weapons) {
      try {
        const parsed = JSON.parse(r.selected_weapons);
        if (Array.isArray(parsed)) selectedNames = new Set(parsed as string[]);
        else if (parsed && typeof parsed === "object") {
          selectedNames = new Set(Object.entries(parsed).filter(([, n]) => (n as number) > 0).map(([k]) => k));
        }
      } catch {
        // ignore malformed selection, fall back to full weapon list
      }
    }
    const weapons = selectedNames ? stats.weapons.filter((w) => selectedNames!.has(w.name)) : stats.weapons;

    const allocation = allocateModelProfiles(stats, r.model_count);
    const models: SimModel[] = [];
    for (const { profile, count } of allocation) {
      const w = parseInt0(profile.W) || 1;
      for (let i = 0; i < count; i++) models.push({ maxWounds: w, curWounds: w });
    }
    if (models.length === 0) continue;

    units.push({
      armyUnitId: r.id,
      name: r.name,
      side,
      stats,
      weapons,
      models,
      oc: parseInt0(stats.OC) || 1,
      zone: deployZone,
      battleShocked: false,
      engaged: false,
      destroyed: false,
      startingModelCount: models.length,
      firedOneShot: [],
    });
  }
  return units;
}

// ─── Battle log ─────────────────────────────────────────────────────────

/** One physical die's result within a resolved attack, for step-by-step
 *  UI animation instead of a silent summary line. `success` is from the
 *  attacker's perspective at every stage (including "save"), so true always
 *  reads as "good news for the attacker": hit landed, wound landed, save
 *  failed (an unsaved wound), self-inflicted hazard avoided. */
export interface DieRoll {
  stage: "hit" | "wound" | "save" | "damage" | "hazard";
  die: number;
  target: number | null;
  success: boolean;
  crit?: boolean;
}

export interface SimLogEntry {
  round: number;
  phase: string;
  message: string;
  rolls?: DieRoll[];
}

export interface SimResult {
  missionKey: string;
  rounds: number;
  vpA: number;
  vpB: number;
  cpA: number;
  cpB: number;
  winner: "a" | "b" | "draw";
  casualtiesA: number;
  casualtiesB: number;
  survivorsA: number;
  survivorsB: number;
}

// ─── Core loop ──────────────────────────────────────────────────────────

/**
 * The minimal shape combat resolution actually needs — SimUnit (zone-based)
 * and the spatial engine's SpatialUnit (lib/battleSimSpatial.ts) both
 * satisfy this structurally, so modelsAlive/resolveAttacks work for either
 * without a shared class hierarchy.
 */
export interface Combatant {
  name: string;
  battleShocked: boolean;
  destroyed: boolean;
  models: SimModel[];
  stats: Pick<UnitStats, "T" | "Sv" | "invuln" | "keywords">;
  /** Names of ONE SHOT weapons this unit has already fired this battle. A
   *  plain array, not a Set — battle state round-trips through
   *  JSON.stringify/parse for DB persistence between decision steps
   *  (lib/battleSimSpatial.ts is stored as state_json), and a Set silently
   *  serializes to "{}" and loses its contents across that round-trip. */
  firedOneShot: string[];
}

export function modelsAlive(u: Combatant): number {
  return u.models.filter((m) => m.curWounds > 0).length;
}

export function totalModels(units: SimUnit[]): number {
  return units.reduce((s, u) => s + u.startingModelCount, 0);
}

export function survivingModels(units: SimUnit[]): number {
  return units.reduce((s, u) => s + modelsAlive(u), 0);
}

export function zoneIndex(z: Zone): number {
  return ZONE_ORDER.indexOf(z);
}

export function stepToward(from: Zone, toward: "mid" | "enemy_a" | "enemy_b", side: "a" | "b"): Zone {
  const idx = zoneIndex(from);
  const dir = side === "a" ? 1 : -1;
  const next = idx + dir;
  return ZONE_ORDER[Math.max(0, Math.min(ZONE_ORDER.length - 1, next))];
}

function applyDamage(unit: Combatant, damage: number): number {
  // Standard allocation: chip an already-wounded model first; a single failed
  // save's damage doesn't spill over onto the next model once one dies.
  let target = unit.models.find((m) => m.curWounds > 0 && m.curWounds < m.maxWounds);
  if (!target) target = unit.models.find((m) => m.curWounds > 0);
  if (!target) return 0;
  const dealt = Math.min(target.curWounds, damage);
  target.curWounds -= dealt;
  return target.curWounds <= 0 ? 1 : 0; // returns 1 if this killed the model
}

/** Only distance/movement context the spatial board can supply — the zone
 *  and live engines don't track real inches, so Rapid Fire/Melta's
 *  half-range bonus simply doesn't apply there, and Heavy's "didn't move"
 *  bonus defaults to true (benefit of the doubt) rather than never applying. */
export interface AttackContext {
  distanceToTarget?: number;
  stationary?: boolean;
  /** Additional flat bonus to the Hit roll (lowers the number needed), e.g. a
   *  detachment rule improving Ballistic Skill. Stacks with Heavy's own +1. */
  hitBonus?: number;
  /** Ignore the attacker's battle-shock -1 to-hit penalty — a detachment
   *  rule effect (e.g. Kauyon's Patient Hunter, rounds 3-5). */
  ignoreHitPenalty?: boolean;
  /** Extra keywords granted to every weapon this call resolves with, beyond
   *  what's printed on the datasheet (e.g. Kauyon granting every T'au ranged
   *  weapon [SUSTAINED HITS 1] in rounds 3-5). */
  forcedKeywords?: WeaponKeyword[];
  /** Additional flat Armour Penetration for this call, from a detachment rule or stratagem (e.g. Kauyon's Point-Blank Ambush). */
  apBonus?: number;
}

// Natural 1 always fails and natural 6 always succeeds/crits regardless of
// modifiers — a core rule, not a house rule — so hit/wound resolution rolls
// the die first and only falls back to the modified target for a 2-5.
function rollAgainst(target: number | null, critAt: number): { die: number; success: boolean; crit: boolean } {
  const die = d6();
  if (die === 1) return { die, success: false, crit: false };
  if (die >= critAt) return { die, success: true, crit: true };
  return { die, success: target != null && die >= target, crit: false };
}

export function resolveAttacks(
  attacker: Combatant,
  defender: Combatant,
  weapons: WeaponProfile[],
  log: (msg: string, rolls?: DieRoll[]) => void,
  ctx: AttackContext = {}
): void {
  const modelsUp = modelsAlive(attacker);
  if (modelsUp === 0) return;
  const toHitPenalty = ctx.ignoreHitPenalty ? 0 : attacker.battleShocked ? 1 : 0;
  const stationary = ctx.stationary !== false;

  for (const w of weapons) {
    if (attacker.firedOneShot.includes(w.name)) continue;
    const keywords = [...parseWeaponKeywords(w.abilities), ...(ctx.forcedKeywords ?? [])];
    // Mark ONE SHOT consumed as soon as it's fired, not once damage resolves
    // — the real rule is "used", not "wounded something" — so this has to
    // happen before any of the early `continue`s below (a whiff still uses
    // the weapon's one shot).
    if (hasKeyword(keywords, "one-shot") && !attacker.firedOneShot.includes(w.name)) attacker.firedOneShot.push(w.name);
    const rolls: DieRoll[] = [];

    let attacksPerModel = rollExpr(w.attacks) || 1;
    if (hasKeyword(keywords, "blast")) attacksPerModel += Math.floor(modelsAlive(defender) / 5);
    const range = parseInt0(w.range);
    const withinHalfRange = ctx.distanceToTarget != null && range > 0 && ctx.distanceToTarget <= range / 2;
    const rapidFire = keywords.find((k): k is Extract<WeaponKeyword, { kind: "rapid-fire" }> => k.kind === "rapid-fire");
    if (rapidFire && withinHalfRange) attacksPerModel += rapidFire.bonus;
    const totalAttacks = attacksPerModel * modelsUp;

    const bsTarget = parseTarget(w.bsWs);
    const autoHit = w.bsWs?.trim() === "-" || hasKeyword(keywords, "torrent");
    const hitBonus = (hasKeyword(keywords, "heavy") && stationary ? 1 : 0) + (ctx.hitBonus ?? 0);
    const hitTarget = bsTarget != null ? Math.min(6, Math.max(2, bsTarget + toHitPenalty - hitBonus)) : null;
    const lethalHits = hasKeyword(keywords, "lethal-hits");
    const sustainedHits = keywords.find((k): k is Extract<WeaponKeyword, { kind: "sustained-hits" }> => k.kind === "sustained-hits");

    // Each hit outcome tracks whether it was a critical hit (for Lethal/
    // Sustained Hits) and whether it auto-wounds (Lethal Hits skips the
    // wound roll for that hit entirely).
    const hitOutcomes: { autoWound: boolean }[] = [];
    for (let i = 0; i < totalAttacks; i++) {
      if (autoHit) {
        hitOutcomes.push({ autoWound: false });
        continue;
      }
      if (hitTarget == null) continue;
      const r = rollAgainst(hitTarget, 6);
      rolls.push({ stage: "hit", die: r.die, target: hitTarget, success: r.success, crit: r.crit });
      if (!r.success) continue;
      hitOutcomes.push({ autoWound: r.crit && lethalHits });
      if (r.crit && sustainedHits) {
        for (let j = 0; j < sustainedHits.bonus; j++) hitOutcomes.push({ autoWound: r.crit && lethalHits });
      }
    }
    // Wound/save/damage only happens if something hit — but Hazardous and
    // the destroyed-check below must still run even on a total whiff (a gun
    // that overheats does so whether or not it hit anything), so this is a
    // guard rather than an early `continue` past them.
    if (hitOutcomes.length === 0) {
      if (rolls.length > 0) log(`${attacker.name} fires ${w.name} at ${defender.name}: no hits.`, rolls);
    } else {
      const strength = parseInt0(w.strength);
      const defenderT = parseInt0(defender.stats.T);
      const wTarget = woundTarget(strength, defenderT);
      const twinLinked = hasKeyword(keywords, "twin-linked");
      const anti = keywords.find(
        (k): k is Extract<WeaponKeyword, { kind: "anti" }> => k.kind === "anti" && defender.stats.keywords.some((dk) => dk.toUpperCase() === k.keyword)
      );
      const critWoundAt = anti ? Math.min(6, anti.threshold) : 6;

      const woundOutcomes: { crit: boolean }[] = [];
      for (const hit of hitOutcomes) {
        if (hit.autoWound) {
          woundOutcomes.push({ crit: false }); // Lethal Hits: wounds automatically, not itself a critical wound
          continue;
        }
        let r = rollAgainst(wTarget, critWoundAt);
        rolls.push({ stage: "wound", die: r.die, target: wTarget, success: r.success, crit: r.crit });
        if (!r.success && twinLinked) {
          r = rollAgainst(wTarget, critWoundAt);
          rolls.push({ stage: "wound", die: r.die, target: wTarget, success: r.success, crit: r.crit });
        }
        if (r.success) woundOutcomes.push({ crit: r.crit });
      }
      if (woundOutcomes.length === 0) {
        if (rolls.length > 0) log(`${attacker.name} fires ${w.name} at ${defender.name}: no wounds got through.`, rolls);
      } else {
        const ap = Math.abs(parseInt0(w.ap)) + (ctx.apBonus ?? 0);
        const armour = parseTarget(defender.stats.Sv);
        const invuln = parseTarget(defender.stats.invuln);
        const modifiedArmour = armour != null ? armour + ap : null;
        const saveTarget =
          invuln != null && (modifiedArmour == null || invuln < modifiedArmour) ? invuln : modifiedArmour;
        const devastatingWounds = hasKeyword(keywords, "devastating-wounds");

        let unsaved = 0;
        let mortalWounds = 0;
        for (const wound of woundOutcomes) {
          if (wound.crit && devastatingWounds) {
            mortalWounds++;
            continue;
          }
          if (saveTarget == null || saveTarget > 6) {
            unsaved++; // no save possible — no die to roll
            continue;
          }
          const saveDie = d6();
          const failed = saveDie < saveTarget;
          rolls.push({ stage: "save", die: saveDie, target: saveTarget, success: failed });
          if (failed) unsaved++;
        }

        const melta = keywords.find((k): k is Extract<WeaponKeyword, { kind: "melta" }> => k.kind === "melta");
        const damageBonus = melta && withinHalfRange ? melta.bonus : 0;

        let modelsKilled = 0;
        for (let i = 0; i < unsaved + mortalWounds; i++) {
          if (modelsAlive(defender) === 0) break;
          const dmg = (rollExpr(w.damage) || 1) + damageBonus;
          rolls.push({ stage: "damage", die: dmg, target: null, success: true });
          modelsKilled += applyDamage(defender, dmg);
        }

        const totalGotThrough = unsaved + mortalWounds;
        if (totalGotThrough > 0) {
          log(
            `${attacker.name} fires ${w.name} at ${defender.name}: ${woundOutcomes.length} wound${woundOutcomes.length === 1 ? "" : "s"}, ${totalGotThrough} unsaved${mortalWounds ? ` (${mortalWounds} devastating)` : ""}${modelsKilled ? `, ${modelsKilled} model${modelsKilled === 1 ? "" : "s"} destroyed` : ""}.`,
            rolls
          );
        } else if (rolls.length > 0) {
          log(`${attacker.name} fires ${w.name} at ${defender.name}: all wounds saved.`, rolls);
        }
      }
    }

    if (hasKeyword(keywords, "hazardous")) {
      const hazardRolls: DieRoll[] = [];
      let hazardMortal = 0;
      for (let i = 0; i < modelsUp; i++) {
        const die = d6();
        const failed = die === 1;
        hazardRolls.push({ stage: "hazard", die, target: 2, success: !failed });
        if (failed) hazardMortal++;
      }
      if (hazardMortal > 0) {
        let killed = 0;
        for (let i = 0; i < hazardMortal; i++) {
          if (modelsAlive(attacker) === 0) break;
          killed += applyDamage(attacker, 1);
        }
        log(`${w.name} overheats on ${attacker.name}: ${hazardMortal} mortal wound${hazardMortal === 1 ? "" : "s"}${killed ? `, ${killed} model${killed === 1 ? "" : "s"} lost` : ""} (Hazardous).`, hazardRolls);
      } else {
        log(`${w.name}'s Hazard rolls come up clean for ${attacker.name} — no mortal wounds.`, hazardRolls);
      }
    }

    if (modelsAlive(defender) === 0) {
      defender.destroyed = true;
      log(`${defender.name} is wiped out.`);
      return;
    }
    if (modelsAlive(attacker) === 0) {
      attacker.destroyed = true;
      log(`${attacker.name} is wiped out.`);
      return;
    }
  }
}

export interface SimulateOptions {
  armyAId: number;
  armyBId: number;
  missionKey: string;
  rounds: number;
}

export function simulateBattle(
  db: Database.Database,
  opts: SimulateOptions,
  onLog: (entry: SimLogEntry) => void
): SimResult {
  const mission = MISSIONS.find((m) => m.key === opts.missionKey) ?? MISSIONS[0];
  const rounds = Math.max(1, Math.min(10, opts.rounds || 5));

  const log = (round: number, phase: string, message: string, rolls?: DieRoll[]) => onLog({ round, phase, message, rolls });

  const unitsA = loadRoster(db, opts.armyAId, "a", "A_DEPLOY");
  const unitsB = loadRoster(db, opts.armyBId, "b", "B_DEPLOY");
  const all = [...unitsA, ...unitsB];

  log(0, "Setup", `Mission: ${mission.name} — ${mission.description}`);
  log(0, "Setup", `Army A fields ${unitsA.length} units (${totalModels(unitsA)} models). Army B fields ${unitsB.length} units (${totalModels(unitsB)} models).`);

  // Roll-off for initiative — the winner acts first every round for the rest
  // of the battle (a fixed choice, not re-rolled each round). Determines
  // shooting priority: the first-acting side can wound the second side's
  // models before they get to shoot back that round.
  let rollA = roll2d6();
  let rollB = roll2d6();
  while (rollA === rollB) { rollA = roll2d6(); rollB = roll2d6(); }
  const firstSide: "a" | "b" = rollA > rollB ? "a" : "b";
  log(0, "Setup", `Initiative roll-off: A rolls ${rollA}, B rolls ${rollB} — Army ${firstSide.toUpperCase()} has the initiative and acts first each round.`);
  const sideOrder: readonly ["a", "b"] | readonly ["b", "a"] = firstSide === "a" ? (["a", "b"] as const) : (["b", "a"] as const);

  let cpA = 1;
  let cpB = 1;
  let vpA = 0;
  let vpB = 0;

  for (let round = 1; round <= rounds; round++) {
    log(round, "Command", `— Battle round ${round} —`);
    cpA += 1;
    cpB += 1;
    log(round, "Command", `Both commanders gain 1CP (A: ${cpA}CP, B: ${cpB}CP).`);

    // Battle-shock: any unit at or below half starting strength tests Ld
    // (2D6 >= Ld to pass). Failing reduces OC to 0 and -1 to Hit this round.
    // Simplified house rule, not a verified transcription of the current
    // core-rule wording.
    for (const u of all) {
      u.battleShocked = false;
      if (u.destroyed) continue;
      if (modelsAlive(u) === 0 || modelsAlive(u) > u.startingModelCount / 2) continue;
      const ld = parseTarget(u.stats.Ld);
      if (ld == null) continue;
      const roll = roll2d6();
      if (roll < ld) {
        u.battleShocked = true;
        log(round, "Command", `${u.name} is Battle-shocked (rolled ${roll}, needed ${ld}+) — OC 0, -1 to Hit this round.`);
      }
    }

    for (const side of sideOrder) {
      const mine = (side === "a" ? unitsA : unitsB).filter((u) => !u.destroyed && modelsAlive(u) > 0);
      const theirs = (side === "a" ? unitsB : unitsA).filter((u) => !u.destroyed && modelsAlive(u) > 0);

      // Movement — advance toward the middle every round; hold only once a
      // live enemy shares the zone (engaged). Units don't camp their own
      // home objective indefinitely — they push in to contest the rest of
      // the board and bring the fight to the enemy, which is what actually
      // produces a battle rather than two armies sitting motionless.
      for (const u of mine) {
        const enemyHere = theirs.some((e) => e.zone === u.zone);
        u.engaged = enemyHere;
        if (enemyHere) continue;
        u.zone = stepToward(u.zone, "mid", side);
      }

      // Shooting — ranged weapons hit targets in the same zone, or an
      // adjacent zone if the weapon's printed range is 18" or more.
      for (const u of mine) {
        if (u.destroyed || modelsAlive(u) === 0) continue;
        const ranged = u.weapons.filter((w) => w.type === "ranged");
        if (ranged.length === 0) continue;
        for (const w of ranged) {
          const range = parseInt0(w.range);
          const target = theirs.find(
            (e) => !e.destroyed && modelsAlive(e) > 0 && (e.zone === u.zone || (range >= 18 && Math.abs(zoneIndex(e.zone) - zoneIndex(u.zone)) <= 1))
          );
          if (target) resolveAttacks(u, target, [w], (msg, rolls) => log(round, "Shooting", msg, rolls));
        }
      }
    }

    // Charge + Fight — any unit sharing a zone with a live enemy is engaged;
    // resolve melee both ways.
    for (const side of sideOrder) {
      const mine = (side === "a" ? unitsA : unitsB).filter((u) => !u.destroyed && modelsAlive(u) > 0);
      const theirs = (side === "a" ? unitsB : unitsA).filter((u) => !u.destroyed && modelsAlive(u) > 0);
      for (const u of mine) {
        const melee = u.weapons.filter((w) => w.type === "melee");
        if (melee.length === 0) continue;
        const target = theirs.find((e) => !e.destroyed && modelsAlive(e) > 0 && e.zone === u.zone);
        if (target) resolveAttacks(u, target, melee, (msg, rolls) => log(round, "Fight", msg, rolls));
      }
    }

    // Scoring
    if (mission.scoringRounds.includes(round)) {
      for (const obj of mission.objectives) {
        const ocA = unitsA.filter((u) => !u.destroyed && u.zone === obj.zone && modelsAlive(u) > 0).reduce((s, u) => s + (u.battleShocked ? 0 : u.oc), 0);
        const ocB = unitsB.filter((u) => !u.destroyed && u.zone === obj.zone && modelsAlive(u) > 0).reduce((s, u) => s + (u.battleShocked ? 0 : u.oc), 0);
        if (ocA > ocB) {
          vpA += obj.vp;
          log(round, "Scoring", `Army A controls ${obj.zone} (OC ${ocA} vs ${ocB}) — +${obj.vp}VP (A: ${vpA}).`);
        } else if (ocB > ocA) {
          vpB += obj.vp;
          log(round, "Scoring", `Army B controls ${obj.zone} (OC ${ocB} vs ${ocA}) — +${obj.vp}VP (B: ${vpB}).`);
        } else {
          log(round, "Scoring", `${obj.zone} is contested (OC ${ocA} vs ${ocB}) — no one scores.`);
        }
      }
    }

    if (unitsA.every((u) => u.destroyed || modelsAlive(u) === 0)) {
      log(round, "Battle round", `Army A has been wiped out.`);
      break;
    }
    if (unitsB.every((u) => u.destroyed || modelsAlive(u) === 0)) {
      log(round, "Battle round", `Army B has been wiped out.`);
      break;
    }
  }

  const survivorsA = survivingModels(unitsA);
  const survivorsB = survivingModels(unitsB);
  const casualtiesA = totalModels(unitsA) - survivorsA;
  const casualtiesB = totalModels(unitsB) - survivorsB;
  const winner: SimResult["winner"] = vpA === vpB ? "draw" : vpA > vpB ? "a" : "b";

  log(0, "Result", `Final score — Army A: ${vpA}VP, Army B: ${vpB}VP. ${winner === "draw" ? "Draw." : `Army ${winner.toUpperCase()} wins.`}`);

  return { missionKey: mission.key, rounds, vpA, vpB, cpA, cpB, winner, casualtiesA, casualtiesB, survivorsA, survivorsB };
}
