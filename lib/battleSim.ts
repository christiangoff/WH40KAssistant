import type Database from "better-sqlite3";
import type { UnitStats, WeaponProfile } from "@/lib/wahapedia";
import { allocateModelProfiles } from "@/lib/wahapedia";

// ─────────────────────────────────────────────────────────────────────────
// Battle simulator — an approximation, not a rules-accurate engine.
//
// This auto-plays a full battle between two armies using each unit's real
// stat line, real weapons, and real dice (hit/wound/save/damage all follow
// the standard 40k tables), but position is abstracted into five zones
// instead of literal inches/line-of-sight, and it does NOT execute
// detachment rules, stratagems, or weapon special abilities (LETHAL HITS,
// SUSTAINED HITS, etc.) mechanically — those are free-text on the datasheet,
// not structured data. Battle-shock and movement are simplified house rules
// loosely inspired by the core rules, not a verified transcription of them.
// Treat results as "a plausible game," not an official ruling.
// ─────────────────────────────────────────────────────────────────────────

export type Zone = "A_DEPLOY" | "A_FIELD" | "MID" | "B_FIELD" | "B_DEPLOY";
const ZONE_ORDER: Zone[] = ["A_DEPLOY", "A_FIELD", "MID", "B_FIELD", "B_DEPLOY"];

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

function roll2d6(): number {
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
function parseTarget(s: string | undefined | null): number | null {
  const m = (s ?? "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseInt0(s: string | undefined | null): number {
  const m = (s ?? "").match(/-?\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

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

interface SimModel {
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
}

interface RosterRow {
  id: number;
  unit_id: number;
  name: string;
  model_count: number;
  selected_weapons: string | null;
  stats_json: string | null;
}

function loadRoster(db: Database.Database, armyId: number, side: "a" | "b", deployZone: Zone): SimUnit[] {
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
    });
  }
  return units;
}

// ─── Battle log ─────────────────────────────────────────────────────────

export interface SimLogEntry {
  round: number;
  phase: string;
  message: string;
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

function modelsAlive(u: SimUnit): number {
  return u.models.filter((m) => m.curWounds > 0).length;
}

function totalModels(units: SimUnit[]): number {
  return units.reduce((s, u) => s + u.startingModelCount, 0);
}

function survivingModels(units: SimUnit[]): number {
  return units.reduce((s, u) => s + modelsAlive(u), 0);
}

function zoneIndex(z: Zone): number {
  return ZONE_ORDER.indexOf(z);
}

function stepToward(from: Zone, toward: "mid" | "enemy_a" | "enemy_b", side: "a" | "b"): Zone {
  const idx = zoneIndex(from);
  const dir = side === "a" ? 1 : -1;
  const next = idx + dir;
  return ZONE_ORDER[Math.max(0, Math.min(ZONE_ORDER.length - 1, next))];
}

function applyDamage(unit: SimUnit, damage: number): number {
  // Standard allocation: chip an already-wounded model first; a single failed
  // save's damage doesn't spill over onto the next model once one dies.
  let target = unit.models.find((m) => m.curWounds > 0 && m.curWounds < m.maxWounds);
  if (!target) target = unit.models.find((m) => m.curWounds > 0);
  if (!target) return 0;
  const dealt = Math.min(target.curWounds, damage);
  target.curWounds -= dealt;
  return target.curWounds <= 0 ? 1 : 0; // returns 1 if this killed the model
}

function resolveAttacks(
  attacker: SimUnit,
  defender: SimUnit,
  weapons: WeaponProfile[],
  log: (msg: string) => void
): void {
  const modelsUp = modelsAlive(attacker);
  if (modelsUp === 0) return;
  const toHitPenalty = attacker.battleShocked ? 1 : 0;

  for (const w of weapons) {
    const attacksPerModel = rollExpr(w.attacks) || 1;
    const totalAttacks = attacksPerModel * modelsUp;
    const bsTarget = parseTarget(w.bsWs);
    const autoHit = w.bsWs?.trim() === "-";
    let hits = 0;
    for (let i = 0; i < totalAttacks; i++) {
      if (autoHit) { hits++; continue; }
      if (bsTarget == null) continue;
      if (d6() >= bsTarget + toHitPenalty) hits++;
    }
    if (hits === 0) continue;

    const strength = parseInt0(w.strength);
    const defenderT = parseInt0(defender.stats.T);
    const wTarget = woundTarget(strength, defenderT);
    let wounds = 0;
    for (let i = 0; i < hits; i++) if (d6() >= wTarget) wounds++;
    if (wounds === 0) continue;

    const ap = Math.abs(parseInt0(w.ap));
    const armour = parseTarget(defender.stats.Sv);
    const invuln = parseTarget(defender.stats.invuln);
    const modifiedArmour = armour != null ? armour + ap : null;
    const saveTarget =
      invuln != null && (modifiedArmour == null || invuln < modifiedArmour) ? invuln : modifiedArmour;

    let unsaved = 0;
    for (let i = 0; i < wounds; i++) {
      if (saveTarget == null || saveTarget > 6 || d6() < saveTarget) unsaved++;
    }
    if (unsaved === 0) continue;

    let modelsKilled = 0;
    for (let i = 0; i < unsaved; i++) {
      if (modelsAlive(defender) === 0) break;
      const dmg = rollExpr(w.damage) || 1;
      modelsKilled += applyDamage(defender, dmg);
    }

    if (unsaved > 0) {
      log(
        `${attacker.name} fires ${w.name} at ${defender.name}: ${hits} hit${hits === 1 ? "" : "s"}, ${wounds} wound${wounds === 1 ? "" : "s"}, ${unsaved} unsaved${modelsKilled ? `, ${modelsKilled} model${modelsKilled === 1 ? "" : "s"} destroyed` : ""}.`
      );
    }
    if (modelsAlive(defender) === 0) {
      defender.destroyed = true;
      log(`${defender.name} is wiped out.`);
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

  const log = (round: number, phase: string, message: string) => onLog({ round, phase, message });

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
          if (target) resolveAttacks(u, target, [w], (msg) => log(round, "Shooting", msg));
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
        if (target) resolveAttacks(u, target, melee, (msg) => log(round, "Fight", msg));
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
