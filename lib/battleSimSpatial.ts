import type Database from "better-sqlite3";
import type { UnitStats, WeaponProfile } from "@/lib/wahapedia";
import { allocateModelProfiles } from "@/lib/wahapedia";
import {
  MISSIONS,
  type SimModel,
  type SimLogEntry,
  type DieRoll,
  type AttackContext,
  parseInt0,
  parseTarget,
  roll2d6,
  resolveAttacks,
} from "@/lib/battleSim";
import { getRuleHooksForSide, type RuleHooks, type StratagemOffer } from "@/lib/ruleHooks";
import {
  BOARD_WIDTH,
  BOARD_DEPTH,
  DEPLOY_DEPTH,
  ENGAGEMENT_RANGE,
  OBJECTIVE_RADIUS,
  MAX_CHARGE_THREAT,
  OBJECTIVE_LAYOUTS,
  dist,
  clampToBoard,
  type Point,
} from "@/lib/battleBoard";

// ─────────────────────────────────────────────────────────────────────────
// Battle simulator — spatial board. Same dice/combat math and the same
// "approximation, not a rules-accurate engine" caveat as lib/battleSim.ts
// (no detachment rules/stratagems/weapon abilities executed, no terrain/
// line-of-sight) — but position is a real 2D board in inches instead of
// zones, so Movement is capped by each unit's actual Move stat, Shooting/
// Charge range is real distance to the real printed Range stat, and there's
// a genuine Charge phase (2D6" vs the gap to the target) that the
// zone-based engine didn't have room for. Whole units move together as one
// group — no per-model positions or unit-coherency rules. Board constants
// live in lib/battleBoard.ts, shared with the client-side renderer.
// ─────────────────────────────────────────────────────────────────────────

export type { Point };

// A Normal move can't end within Engagement Range of a live enemy — that's
// specifically what the Charge phase is for. Pulls `to` back along the
// straight line from `from` to just outside ENGAGEMENT_RANGE of the nearest
// enemy it would otherwise land inside of. `from` is assumed to already be
// legal (outside engagement range of everyone) — true here since Movement
// decisions are only offered to units that aren't already engaged.
function clampAwayFromEnemies(from: Point, to: Point, enemies: { position: Point }[]): Point {
  let result = to;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const a = dx * dx + dy * dy;
  if (a === 0) return result;

  for (const e of enemies) {
    if (dist(result, e.position) >= ENGAGEMENT_RANGE) continue;
    const fx = from.x - e.position.x;
    const fy = from.y - e.position.y;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - ENGAGEMENT_RANGE * ENGAGEMENT_RANGE;
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue; // shouldn't happen given `from` starts outside every enemy's ring
    const sqrtDisc = Math.sqrt(disc);
    const candidates = [(-b - sqrtDisc) / (2 * a), (-b + sqrtDisc) / (2 * a)].filter((t) => t >= 0 && t <= 1);
    const t = candidates.length ? Math.min(...candidates) : 0;
    const stopPoint = { x: from.x + dx * t, y: from.y + dy * t };
    if (dist(from, stopPoint) < dist(from, result)) result = stopPoint;
  }
  return result;
}

// ─── Roster ─────────────────────────────────────────────────────────────

export interface SpatialUnit {
  armyUnitId: number;
  name: string;
  side: "a" | "b";
  stats: UnitStats;
  weapons: WeaponProfile[];
  models: SimModel[];
  oc: number;
  position: Point;
  moveInches: number;
  battleShocked: boolean;
  engaged: boolean;
  destroyed: boolean;
  startingModelCount: number;
  firedOneShot: string[];
  /** Did this unit move during its side's Movement step this round? Feeds Heavy's "remained stationary" bonus. Defaults true (stationary) until Movement resolves each round. */
  movedThisTurn: boolean;
}

interface RosterRow {
  id: number;
  unit_id: number;
  name: string;
  model_count: number;
  selected_weapons: string | null;
  stats_json: string | null;
}

function loadArmyDetachmentName(db: Database.Database, armyId: number): string | null {
  const row = db
    .prepare(
      `SELECT d.name FROM army_detachments ad JOIN detachments d ON d.id = ad.detachment_id
       WHERE ad.army_id = ? ORDER BY ad.id ASC LIMIT 1`
    )
    .get(armyId) as { name: string } | undefined;
  return row?.name ?? null;
}

function loadArmyFactionName(db: Database.Database, armyId: number): string | null {
  const row = db
    .prepare(
      `SELECT COALESCE(f.name, a.faction) AS name FROM armies a LEFT JOIN factions f ON f.id = a.faction_id WHERE a.id = ?`
    )
    .get(armyId) as { name: string | null } | undefined;
  return row?.name ?? null;
}

function loadSpatialRoster(db: Database.Database, armyId: number, side: "a" | "b"): SpatialUnit[] {
  const rows = db
    .prepare(
      `SELECT au.id, au.unit_id, u.name, au.model_count, au.selected_weapons, u.stats_json
       FROM army_units au JOIN units u ON u.id = au.unit_id
       WHERE au.army_id = ? ORDER BY au.id ASC`
    )
    .all(armyId) as RosterRow[];

  const parsed: { row: RosterRow; stats: UnitStats }[] = [];
  for (const r of rows) {
    if (!r.stats_json) continue;
    parsed.push({ row: r, stats: JSON.parse(r.stats_json) });
  }

  const y = side === "a" ? DEPLOY_DEPTH / 2 : BOARD_DEPTH - DEPLOY_DEPTH / 2;

  const units: SpatialUnit[] = [];
  parsed.forEach(({ row: r, stats }, i) => {
    let selectedNames: Set<string> | null = null;
    if (r.selected_weapons) {
      try {
        const sel = JSON.parse(r.selected_weapons);
        if (Array.isArray(sel)) selectedNames = new Set(sel as string[]);
        else if (sel && typeof sel === "object") {
          selectedNames = new Set(Object.entries(sel).filter(([, n]) => (n as number) > 0).map(([k]) => k));
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
      for (let j = 0; j < count; j++) models.push({ maxWounds: w, curWounds: w });
    }
    if (models.length === 0) return;

    units.push({
      armyUnitId: r.id,
      name: r.name,
      side,
      stats,
      weapons,
      models,
      oc: parseInt0(stats.OC) || 1,
      position: { x: ((i + 1) * BOARD_WIDTH) / (parsed.length + 1), y },
      moveInches: parseInt0(stats.M) || 6,
      battleShocked: false,
      engaged: false,
      destroyed: false,
      startingModelCount: models.length,
      firedOneShot: [],
      movedThisTurn: false,
    });
  });
  return units;
}

function modelsAlive(u: SpatialUnit): number {
  return u.models.filter((m) => m.curWounds > 0).length;
}

function aliveUnits(units: SpatialUnit[]): SpatialUnit[] {
  return units.filter((u) => !u.destroyed && modelsAlive(u) > 0);
}

function totalModels(units: SpatialUnit[]): number {
  return units.reduce((s, u) => s + u.startingModelCount, 0);
}

// ─── State ──────────────────────────────────────────────────────────────

type StepKind = "command" | "movement" | "shooting" | "charge" | "fight" | "scoring";

interface RoundStep {
  kind: StepKind;
  side?: "a" | "b";
}

function buildSteps(sideOrder: readonly ["a", "b"] | readonly ["b", "a"]): RoundStep[] {
  return [
    { kind: "command" },
    { kind: "movement", side: sideOrder[0] },
    { kind: "shooting", side: sideOrder[0] },
    { kind: "charge", side: sideOrder[0] },
    { kind: "movement", side: sideOrder[1] },
    { kind: "shooting", side: sideOrder[1] },
    { kind: "charge", side: sideOrder[1] },
    { kind: "fight", side: sideOrder[0] },
    { kind: "fight", side: sideOrder[1] },
    { kind: "scoring" },
  ];
}

export interface PendingDecision {
  armyUnitId: number;
  unitName: string;
  position: Point;
  moveInches: number;
  kind: "movement" | "shooting" | "charge";
  targets?: { armyUnitId: number; name: string; position: Point; distance: number }[];
  /**
   * Shooting only, and only for units eligible to be an Observer under a
   * "For the Greater Good"-style hook: every living enemy unit, regardless
   * of range — spotting only needs visibility, not a weapon in range. A
   * decision value of "spot:<armyUnitId>" picks one instead of shooting.
   * lib/ruleHooks/tau.ts.
   */
  spotCandidates?: { armyUnitId: number; name: string }[];
  /** Shooting only: real-rules stratagems affordable for this unit right
   *  now (from a detachment's rule hook). Prefix a shooting decision value
   *  with "strat:<key>:" to spend one before resolving the shot, e.g.
   *  "strat:point-blank-ambush:42:17" to fire at target 17 with it active. */
  stratagemOffers?: StratagemOffer[];
  /**
   * Shooting only, when a unit has 2+ distinct ranged weapon names: each
   * weapon's own reachable targets, so they can be split across different
   * enemies instead of the whole unit committing to one. Submit as a JSON
   * decision value `{"<weaponName>": "<armyUnitId>" | "hold_fire", ...}`
   * instead of the plain single-target string.
   */
  weaponTargets?: { weapon: string; targets: { armyUnitId: number; name: string; distance: number }[] }[];
}

export interface SpatialBattleState {
  missionKey: string;
  maxRounds: number;
  round: number;
  stepIndex: number;
  sideOrder: ["a", "b"] | ["b", "a"];
  playerSide: "a" | "b";
  cpA: number;
  cpB: number;
  vpA: number;
  vpB: number;
  unitsA: SpatialUnit[];
  unitsB: SpatialUnit[];
  /** Fixed for the whole battle — computed once at creation so the board
   *  renderer doesn't need its own copy of the mission-layout table. */
  objectives: { position: Point; vp: number }[];
  winner?: "a" | "b" | "draw";
  /** Faction/detachment names per side — drives lib/ruleHooks/ lookups and
   *  the board's "Real rules: X" badge. Null when unlinked/unset. */
  factionA: string | null;
  factionB: string | null;
  detachmentA: string | null;
  detachmentB: string | null;
  /** Scratch space for rule hooks that need phase-scoped state (e.g. T'au's
   *  Observer/Spotted tracking) — keyed by hook key, shape owned by the hook. */
  hookScratch?: Record<string, unknown>;
}

export interface AdvanceResult {
  state: SpatialBattleState;
  log: SimLogEntry[];
  pending: PendingDecision[] | null;
}

function sideUnits(state: SpatialBattleState, side: "a" | "b"): SpatialUnit[] {
  return side === "a" ? state.unitsA : state.unitsB;
}

export function newSpatialBattle(
  db: Database.Database,
  opts: { playerArmyId: number; opponentArmyId: number; missionKey: string; maxRounds: number; playerSide: "a" | "b" }
): { state: SpatialBattleState; log: SimLogEntry[] } {
  const log: SimLogEntry[] = [];
  const push = (round: number, phase: string, message: string, rolls?: DieRoll[]) => log.push({ round, phase, message, rolls });

  const mission = MISSIONS.find((m) => m.key === opts.missionKey) ?? MISSIONS[0];
  const armyAId = opts.playerSide === "a" ? opts.playerArmyId : opts.opponentArmyId;
  const armyBId = opts.playerSide === "a" ? opts.opponentArmyId : opts.playerArmyId;

  const unitsA = loadSpatialRoster(db, armyAId, "a");
  const unitsB = loadSpatialRoster(db, armyBId, "b");
  const factionA = loadArmyFactionName(db, armyAId);
  const factionB = loadArmyFactionName(db, armyBId);
  const detachmentA = loadArmyDetachmentName(db, armyAId);
  const detachmentB = loadArmyDetachmentName(db, armyBId);

  push(0, "Setup", `Mission: ${mission.name} — ${mission.description}`);
  push(0, "Setup", `Board: ${BOARD_WIDTH}"×${BOARD_DEPTH}". Army A fields ${unitsA.length} units (${totalModels(unitsA)} models). Army B fields ${unitsB.length} units (${totalModels(unitsB)} models).`);

  let rollA = roll2d6();
  let rollB = roll2d6();
  while (rollA === rollB) { rollA = roll2d6(); rollB = roll2d6(); }
  const firstSide: "a" | "b" = rollA > rollB ? "a" : "b";
  push(0, "Setup", `Initiative roll-off: A rolls ${rollA}, B rolls ${rollB} — Army ${firstSide.toUpperCase()} has the initiative and acts first each round.`);
  const sideOrder: ["a", "b"] | ["b", "a"] = firstSide === "a" ? ["a", "b"] : ["b", "a"];

  const state: SpatialBattleState = {
    missionKey: mission.key,
    maxRounds: opts.maxRounds,
    round: 1,
    stepIndex: 0,
    sideOrder,
    playerSide: opts.playerSide,
    cpA: 1,
    cpB: 1,
    vpA: 0,
    vpB: 0,
    unitsA,
    unitsB,
    objectives: OBJECTIVE_LAYOUTS[mission.key] ?? OBJECTIVE_LAYOUTS[MISSIONS[0].key],
    factionA,
    factionB,
    detachmentA,
    detachmentB,
  };

  const hooksA = hooksForSide(state, "a");
  const hooksB = hooksForSide(state, "b");
  for (const h of hooksA) push(0, "Setup", `Army A plays with real rules for: ${h.label}.`);
  for (const h of hooksB) push(0, "Setup", `Army B plays with real rules for: ${h.label}.`);

  return { state, log };
}

function hooksForSide(state: SpatialBattleState, side: "a" | "b"): RuleHooks[] {
  return side === "a"
    ? getRuleHooksForSide(state.factionA, state.detachmentA)
    : getRuleHooksForSide(state.factionB, state.detachmentB);
}

// Every ranged weapon on `u` whose printed Range reaches `target`.
function reachableRangedWeapons(u: SpatialUnit, target: SpatialUnit): WeaponProfile[] {
  const d = dist(u.position, target.position);
  return u.weapons.filter((w) => w.type === "ranged" && parseInt0(w.range) >= d);
}

function validRangedTargets(u: SpatialUnit, enemies: SpatialUnit[]): SpatialUnit[] {
  return enemies.filter((e) => !e.destroyed && modelsAlive(e) > 0 && reachableRangedWeapons(u, e).length > 0);
}

function chargeableTargets(u: SpatialUnit, enemies: SpatialUnit[]): SpatialUnit[] {
  return enemies.filter(
    (e) => !e.destroyed && modelsAlive(e) > 0 && dist(u.position, e.position) > ENGAGEMENT_RANGE && dist(u.position, e.position) <= MAX_CHARGE_THREAT
  );
}

function isEngaged(u: SpatialUnit, enemies: SpatialUnit[]): boolean {
  return enemies.some((e) => !e.destroyed && modelsAlive(e) > 0 && dist(u.position, e.position) <= ENGAGEMENT_RANGE);
}

// Finish off something already wounded, else the nearest option. Not
// tactical play, just a reasonable default for the computer opponent.
function aiPickTarget(u: SpatialUnit, candidates: SpatialUnit[]): SpatialUnit | null {
  if (candidates.length === 0) return null;
  const wounded = candidates.find((c) => c.models.some((m) => m.curWounds < m.maxWounds));
  if (wounded) return wounded;
  return [...candidates].sort((a, b) => dist(u.position, a.position) - dist(u.position, b.position))[0];
}

function computeDecisionsForStep(state: SpatialBattleState, step: RoundStep): PendingDecision[] {
  if (step.side !== state.playerSide) return [];
  const mine = aliveUnits(sideUnits(state, step.side));
  const theirs = aliveUnits(sideUnits(state, step.side === "a" ? "b" : "a"));

  if (step.kind === "movement") {
    return mine
      .filter((u) => !isEngaged(u, theirs))
      .map((u) => ({ armyUnitId: u.armyUnitId, unitName: u.name, position: u.position, moveInches: u.moveInches, kind: "movement" as const }));
  }
  if (step.kind === "shooting") {
    const hooks = hooksForSide(state, step.side);
    const hookCtx = { state, side: step.side };
    const out: PendingDecision[] = [];
    for (const u of mine) {
      const spotCandidates = hooks.some((h) => h.spotEligible?.(hookCtx, u))
        ? theirs.map((t) => ({ armyUnitId: t.armyUnitId, name: t.name }))
        : undefined;
      if (!u.weapons.some((w) => w.type === "ranged")) {
        if (spotCandidates && spotCandidates.length > 0) {
          out.push({ armyUnitId: u.armyUnitId, unitName: u.name, position: u.position, moveInches: u.moveInches, kind: "shooting", spotCandidates });
        }
        continue;
      }
      const targets = validRangedTargets(u, theirs);
      const stratagemOffers = hooks.flatMap((h) => h.offerStratagems?.(hookCtx, "pre-shoot", u) ?? []);
      const rangedNames = [...new Set(u.weapons.filter((w) => w.type === "ranged").map((w) => w.name))];
      const weaponTargets =
        rangedNames.length > 1
          ? rangedNames.map((name) => ({
              weapon: name,
              targets: theirs
                .filter((t) => !t.destroyed && modelsAlive(t) > 0 && parseInt0(u.weapons.find((w) => w.name === name)?.range) >= dist(u.position, t.position))
                .map((t) => ({ armyUnitId: t.armyUnitId, name: t.name, distance: Math.round(dist(u.position, t.position) * 10) / 10 })),
            }))
          : undefined;
      if (targets.length > 0 || (spotCandidates && spotCandidates.length > 0)) {
        out.push({
          armyUnitId: u.armyUnitId,
          unitName: u.name,
          position: u.position,
          moveInches: u.moveInches,
          kind: "shooting",
          targets: targets.map((t) => ({ armyUnitId: t.armyUnitId, name: t.name, position: t.position, distance: Math.round(dist(u.position, t.position) * 10) / 10 })),
          spotCandidates,
          stratagemOffers: stratagemOffers.length > 0 ? stratagemOffers : undefined,
          weaponTargets,
        });
      }
    }
    return out;
  }
  if (step.kind === "charge") {
    const out: PendingDecision[] = [];
    for (const u of mine) {
      if (isEngaged(u, theirs)) continue;
      const targets = chargeableTargets(u, theirs);
      if (targets.length > 0) {
        out.push({
          armyUnitId: u.armyUnitId,
          unitName: u.name,
          position: u.position,
          moveInches: u.moveInches,
          kind: "charge",
          targets: targets.map((t) => ({ armyUnitId: t.armyUnitId, name: t.name, position: t.position, distance: Math.round(dist(u.position, t.position) * 10) / 10 })),
        });
      }
    }
    return out;
  }
  return [];
}

function resolveStep(
  state: SpatialBattleState,
  step: RoundStep,
  decisions: Record<string, string> | undefined,
  push: (round: number, phase: string, message: string, rolls?: DieRoll[]) => void
): void {
  if (step.kind === "command") {
    push(state.round, "Command", `— Battle round ${state.round} —`);
    state.cpA += 1;
    state.cpB += 1;
    push(state.round, "Command", `Both commanders gain 1CP (A: ${state.cpA}CP, B: ${state.cpB}CP).`);
    for (const u of [...state.unitsA, ...state.unitsB]) {
      u.battleShocked = false;
      if (u.destroyed || modelsAlive(u) === 0) continue;
      if (modelsAlive(u) > u.startingModelCount / 2) continue;
      const ld = parseTarget(u.stats.Ld);
      if (ld == null) continue;
      const roll = roll2d6();
      if (roll < ld) {
        u.battleShocked = true;
        push(state.round, "Command", `${u.name} is Battle-shocked (rolled ${roll}, needed ${ld}+) — OC 0, -1 to Hit this round.`);
      }
    }
    return;
  }

  if (step.kind === "movement") {
    const side = step.side!;
    const mine = aliveUnits(sideUnits(state, side));
    const theirs = aliveUnits(sideUnits(state, side === "a" ? "b" : "a"));
    const isPlayer = side === state.playerSide;
    for (const u of mine) {
      u.engaged = isEngaged(u, theirs);
      u.movedThisTurn = false;
      if (u.engaged) continue;

      let target: Point | null = null;
      if (isPlayer) {
        const raw = decisions?.[String(u.armyUnitId)];
        if (raw && raw !== "hold") {
          try {
            target = JSON.parse(raw) as Point;
          } catch {
            target = null;
          }
        }
      } else {
        // AI: move straight toward the nearest living enemy.
        const nearest = [...theirs].sort((a, b) => dist(u.position, a.position) - dist(u.position, b.position))[0];
        if (nearest) target = nearest.position;
      }
      if (!target) {
        push(state.round, "Movement", `${u.name} holds position.`);
        continue;
      }

      const clamped = clampToBoard(target);
      const d = dist(u.position, clamped);
      const from = u.position;
      let dest: Point;
      if (d <= u.moveInches || d === 0) {
        dest = clamped;
      } else {
        const t = u.moveInches / d;
        dest = clampToBoard({ x: from.x + (clamped.x - from.x) * t, y: from.y + (clamped.y - from.y) * t });
      }
      // A Normal move can't end within Engagement Range of a live enemy —
      // that's what Charge is for. Pull back short of it if it would.
      u.position = clampAwayFromEnemies(from, dest, theirs);
      const moved = Math.round(dist(from, u.position) * 10) / 10;
      if (moved < 0.05) {
        push(state.round, "Movement", `${u.name} holds position (can't advance closer without charging).`);
      } else {
        u.movedThisTurn = true;
        push(state.round, "Movement", `${u.name} moves ${moved}" (M${u.moveInches}").`);
      }
    }
    return;
  }

  if (step.kind === "shooting") {
    const side = step.side!;
    const mine = aliveUnits(sideUnits(state, side));
    const theirs = aliveUnits(sideUnits(state, side === "a" ? "b" : "a"));
    const isPlayer = side === state.playerSide;
    const hooks = hooksForSide(state, side);
    const hookCtx = { state, side };

    // Phase-start pass: resolve any "spot instead of shooting" declarations
    // (lib/ruleHooks/tau.ts's For the Greater Good) before anyone fires, so
    // Spotted/Guided status is known for every shot this phase — see the
    // ordering note on lib/ruleHooks/tau.ts's header comment.
    for (const h of hooks) h.onShootingPhaseStart?.(hookCtx, isPlayer ? decisions : undefined, (msg) => push(state.round, "Shooting", msg));

    for (const u of mine) {
      if (!u.weapons.some((w) => w.type === "ranged")) continue;
      const targets = validRangedTargets(u, theirs);
      if (targets.length === 0) continue;

      let choice = isPlayer ? decisions?.[String(u.armyUnitId)] : undefined;
      if (choice?.startsWith("spot:")) continue; // resolved in the phase-start pass above, doesn't also shoot

      // Note: a "strat:" prefix and a JSON weapon-split value can't combine
      // in one decision string (both use ":" internally) — not needed by
      // this slice's one stratagem (Point-Blank Ambush is unit-wide, not
      // per-weapon), so left unsupported rather than over-engineered.
      let stratPatch: AttackContext = {};
      if (choice?.startsWith("strat:")) {
        const parts = choice.split(":"); // "strat:<key>:<restOfChoice...>"
        const offerKey = parts[1];
        choice = parts.slice(2).join(":");
        const offer = hooks.flatMap((h) => h.offerStratagems?.(hookCtx, "pre-shoot", u) ?? []).find((o) => o.key === offerKey);
        const cpPool = side === "a" ? "cpA" : "cpB";
        if (offer && state[cpPool] >= offer.cp) {
          state[cpPool] -= offer.cp;
          push(state.round, "Shooting", `${u.name} uses ${offer.name} (${offer.cp}CP).`);
          for (const h of hooks) {
            const patch = h.applyStratagem?.(hookCtx, offerKey, u);
            if (patch) stratPatch = { ...stratPatch, ...patch };
          }
        }
      }

      // Per-weapon target split — see PendingDecision.weaponTargets. A JSON
      // decision value maps each distinct ranged weapon name to its own
      // target (or "hold_fire"), instead of the whole unit committing to
      // a single enemy.
      if (isPlayer && choice?.trim().startsWith("{")) {
        let split: Record<string, string> = {};
        try {
          split = JSON.parse(choice);
        } catch {
          split = {};
        }
        for (const [weaponName, weaponChoice] of Object.entries(split)) {
          if (!weaponChoice || weaponChoice === "hold_fire") continue;
          const wTarget = targets.find((t) => String(t.armyUnitId) === weaponChoice);
          if (!wTarget || wTarget.destroyed || modelsAlive(wTarget) === 0) continue; // an earlier weapon in this same split may have already destroyed it
          const weapon = u.weapons.find((w) => w.name === weaponName && w.type === "ranged" && parseInt0(w.range) >= dist(u.position, wTarget.position));
          if (!weapon) continue;
          let wCtx: AttackContext = { distanceToTarget: dist(u.position, wTarget.position), stationary: !u.movedThisTurn, ...stratPatch };
          for (const h of hooks) if (h.modifyAttackContext) wCtx = h.modifyAttackContext(hookCtx, u, wTarget, wCtx);
          resolveAttacks(u, wTarget, [weapon], (msg, rolls) => push(state.round, "Shooting", msg, rolls), wCtx);
        }
        continue;
      }

      let target: SpatialUnit | null;
      if (isPlayer) {
        if (!choice || choice === "hold_fire") {
          if (choice === "hold_fire") push(state.round, "Shooting", `${u.name} holds fire.`);
          continue;
        }
        target = targets.find((t) => String(t.armyUnitId) === choice) ?? null;
        if (!target) continue;
      } else {
        target = aiPickTarget(u, targets);
        if (!target) continue;
      }
      const weapons = reachableRangedWeapons(u, target);
      if (weapons.length === 0) continue;

      let ctx: AttackContext = { distanceToTarget: dist(u.position, target.position), stationary: !u.movedThisTurn, ...stratPatch };
      for (const h of hooks) if (h.modifyAttackContext) ctx = h.modifyAttackContext(hookCtx, u, target, ctx);
      resolveAttacks(u, target, weapons, (msg, rolls) => push(state.round, "Shooting", msg, rolls), ctx);
    }
    return;
  }

  if (step.kind === "charge") {
    const side = step.side!;
    const mine = aliveUnits(sideUnits(state, side));
    const theirs = aliveUnits(sideUnits(state, side === "a" ? "b" : "a"));
    const isPlayer = side === state.playerSide;
    for (const u of mine) {
      if (isEngaged(u, theirs)) continue;
      const targets = chargeableTargets(u, theirs);
      if (targets.length === 0) continue;

      let target: SpatialUnit | null;
      if (isPlayer) {
        const choice = decisions?.[String(u.armyUnitId)];
        if (!choice || choice === "decline") continue;
        target = targets.find((t) => String(t.armyUnitId) === choice) ?? null;
        if (!target) continue;
      } else {
        target = [...targets].sort((a, b) => dist(u.position, a.position) - dist(u.position, b.position))[0];
      }

      const gap = dist(u.position, target.position);
      const roll = roll2d6();
      if (roll >= gap) {
        const dx = u.position.x - target.position.x;
        const dy = u.position.y - target.position.y;
        const len = Math.hypot(dx, dy) || 1;
        u.position = clampToBoard({
          x: target.position.x + (dx / len) * ENGAGEMENT_RANGE,
          y: target.position.y + (dy / len) * ENGAGEMENT_RANGE,
        });
        u.engaged = true;
        push(state.round, "Charge", `${u.name} charges ${target.name} (rolled ${roll}", needed ${Math.ceil(gap)}") — engaged!`);
      } else {
        push(state.round, "Charge", `${u.name}'s charge at ${target.name} fails (rolled ${roll}", needed ${Math.ceil(gap)}").`);
      }
    }
    return;
  }

  if (step.kind === "fight") {
    const side = step.side!;
    const mine = aliveUnits(sideUnits(state, side));
    const theirs = aliveUnits(sideUnits(state, side === "a" ? "b" : "a"));
    for (const u of mine) {
      const melee = u.weapons.filter((w) => w.type === "melee");
      if (melee.length === 0) continue;
      const target = theirs.find((e) => dist(u.position, e.position) <= ENGAGEMENT_RANGE);
      if (!target) continue;
      resolveAttacks(u, target, melee, (msg, rolls) => push(state.round, "Fight", msg, rolls));
    }
    return;
  }

  // scoring
  const mission = MISSIONS.find((m) => m.key === state.missionKey) ?? MISSIONS[0];
  if (!mission.scoringRounds.includes(state.round)) return;
  const layout = state.objectives;
  for (const [i, obj] of layout.entries()) {
    const ocA = aliveUnits(state.unitsA)
      .filter((u) => dist(u.position, obj.position) <= OBJECTIVE_RADIUS)
      .reduce((s, u) => s + (u.battleShocked ? 0 : u.oc), 0);
    const ocB = aliveUnits(state.unitsB)
      .filter((u) => dist(u.position, obj.position) <= OBJECTIVE_RADIUS)
      .reduce((s, u) => s + (u.battleShocked ? 0 : u.oc), 0);
    const label = `Objective ${i + 1}`;
    if (ocA > ocB) {
      state.vpA += obj.vp;
      push(state.round, "Scoring", `Army A controls ${label} (OC ${ocA} vs ${ocB}) — +${obj.vp}VP (A: ${state.vpA}).`);
    } else if (ocB > ocA) {
      state.vpB += obj.vp;
      push(state.round, "Scoring", `Army B controls ${label} (OC ${ocB} vs ${ocA}) — +${obj.vp}VP (B: ${state.vpB}).`);
    } else {
      push(state.round, "Scoring", `${label} is contested (OC ${ocA} vs ${ocB}) — no one scores.`);
    }
  }
}

function finishBattle(state: SpatialBattleState, push: (round: number, phase: string, message: string, rolls?: DieRoll[]) => void): void {
  state.winner = state.vpA === state.vpB ? "draw" : state.vpA > state.vpB ? "a" : "b";
  push(0, "Result", `Final score — Army A: ${state.vpA}VP, Army B: ${state.vpB}VP. ${state.winner === "draw" ? "Draw." : `Army ${state.winner.toUpperCase()} wins.`}`);
}

function checkGameOver(state: SpatialBattleState, push: (round: number, phase: string, message: string, rolls?: DieRoll[]) => void): boolean {
  const aDead = state.unitsA.every((u) => u.destroyed || modelsAlive(u) === 0);
  const bDead = state.unitsB.every((u) => u.destroyed || modelsAlive(u) === 0);
  if (!aDead && !bDead) return false;
  if (aDead) push(state.round, "Battle round", "Army A has been wiped out.");
  if (bDead) push(state.round, "Battle round", "Army B has been wiped out.");
  finishBattle(state, push);
  return true;
}

/**
 * Advances the battle from wherever it currently sits — same pause/resume
 * contract as lib/battleSimLive.ts's advanceLiveBattle. Movement decisions
 * are `{x,y}` (JSON-stringified) or "hold"; shooting/charge decisions are a
 * target armyUnitId (stringified) or "hold_fire"/"decline".
 */
export function advanceSpatialBattle(state: SpatialBattleState, decisions?: Record<string, string>): AdvanceResult {
  const log: SimLogEntry[] = [];
  const push = (round: number, phase: string, message: string, rolls?: DieRoll[]) => log.push({ round, phase, message, rolls });

  if (state.winner) return { state, log, pending: null };

  for (;;) {
    const steps = buildSteps(state.sideOrder);
    const step = steps[state.stepIndex];

    const pending = computeDecisionsForStep(state, step);
    if (pending.length > 0 && !decisions) {
      return { state, log, pending };
    }

    resolveStep(state, step, decisions, push);
    decisions = undefined;

    if (checkGameOver(state, push)) return { state, log, pending: null };

    state.stepIndex += 1;
    if (state.stepIndex >= steps.length) {
      if (state.round >= state.maxRounds) {
        finishBattle(state, push);
        return { state, log, pending: null };
      }
      state.round += 1;
      state.stepIndex = 0;
    }
  }
}

/** Rule-hook labels active for a side right now — drives the board's
 *  "⚡ Real rules: X" badge vs. "Generic rules". */
export function activeRuleHookLabels(state: SpatialBattleState, side: "a" | "b"): string[] {
  return hooksForSide(state, side).map((h) => h.label);
}
