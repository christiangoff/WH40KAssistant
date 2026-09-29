import type Database from "better-sqlite3";
import {
  MISSIONS,
  type Zone,
  type SimUnit,
  type SimLogEntry,
  loadRoster,
  modelsAlive,
  totalModels,
  zoneIndex,
  stepToward,
  resolveAttacks,
  roll2d6,
  parseTarget,
  parseInt0,
} from "@/lib/battleSim";

// ─────────────────────────────────────────────────────────────────────────
// Interactive battle simulator — the same engine/dice/rules as lib/battleSim.ts
// (see its header comment for what this does and doesn't simulate), but
// played phase by phase against a computer opponent instead of run straight
// through. You control one side's Movement (advance/hold per unit) and
// Shooting (target choice per unit, or hold fire) decisions; the computer's
// entire turn resolves automatically, as does your Fight phase (whoever's
// engaged fights — no separate choice in v1).
// ─────────────────────────────────────────────────────────────────────────

type LiveStepKind = "command" | "movement" | "shooting" | "fight" | "scoring";

interface RoundStep {
  kind: LiveStepKind;
  side?: "a" | "b";
}

function buildSteps(sideOrder: readonly ["a", "b"] | readonly ["b", "a"]): RoundStep[] {
  return [
    { kind: "command" },
    { kind: "movement", side: sideOrder[0] },
    { kind: "shooting", side: sideOrder[0] },
    { kind: "movement", side: sideOrder[1] },
    { kind: "shooting", side: sideOrder[1] },
    { kind: "fight", side: sideOrder[0] },
    { kind: "fight", side: sideOrder[1] },
    { kind: "scoring" },
  ];
}

export interface PendingDecision {
  armyUnitId: number;
  unitName: string;
  zone: Zone;
  kind: "movement" | "shooting";
  /** Shooting only: valid targets to choose from (plus an implicit "hold fire"). */
  targets?: { armyUnitId: number; name: string }[];
}

export interface LiveBattleState {
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
  unitsA: SimUnit[];
  unitsB: SimUnit[];
  winner?: "a" | "b" | "draw";
}

export interface AdvanceResult {
  state: LiveBattleState;
  log: SimLogEntry[];
  /** null once the battle is over; otherwise what the human needs to decide right now (may be empty while waiting on nothing — battle keeps auto-advancing until this is non-empty or the game ends). */
  pending: PendingDecision[] | null;
}

function sideUnits(state: LiveBattleState, side: "a" | "b"): SimUnit[] {
  return side === "a" ? state.unitsA : state.unitsB;
}

function aliveUnits(units: SimUnit[]): SimUnit[] {
  return units.filter((u) => !u.destroyed && modelsAlive(u) > 0);
}

function validRangedTargets(u: SimUnit, enemies: SimUnit[]): SimUnit[] {
  return enemies.filter(
    (e) =>
      !e.destroyed &&
      modelsAlive(e) > 0 &&
      u.weapons.some(
        (w) =>
          w.type === "ranged" &&
          (e.zone === u.zone || (parseInt0(w.range) >= 18 && Math.abs(zoneIndex(e.zone) - zoneIndex(u.zone)) <= 1))
      )
  );
}

// Simple AI target choice: finish off something already wounded, else the
// first valid option. Not tactical play, just a reasonable default.
function aiPickTarget(candidates: SimUnit[]): SimUnit | null {
  if (candidates.length === 0) return null;
  return candidates.find((c) => c.models.some((m) => m.curWounds < m.maxWounds)) ?? candidates[0];
}

export function newLiveBattle(
  db: Database.Database,
  opts: { playerArmyId: number; opponentArmyId: number; missionKey: string; maxRounds: number; playerSide: "a" | "b" }
): { state: LiveBattleState; log: SimLogEntry[] } {
  const log: SimLogEntry[] = [];
  const push = (round: number, phase: string, message: string) => log.push({ round, phase, message });

  const mission = MISSIONS.find((m) => m.key === opts.missionKey) ?? MISSIONS[0];
  const armyAId = opts.playerSide === "a" ? opts.playerArmyId : opts.opponentArmyId;
  const armyBId = opts.playerSide === "a" ? opts.opponentArmyId : opts.playerArmyId;

  const unitsA = loadRoster(db, armyAId, "a", "A_DEPLOY");
  const unitsB = loadRoster(db, armyBId, "b", "B_DEPLOY");

  push(0, "Setup", `Mission: ${mission.name} — ${mission.description}`);
  push(0, "Setup", `Army A fields ${unitsA.length} units (${totalModels(unitsA)} models). Army B fields ${unitsB.length} units (${totalModels(unitsB)} models).`);

  let rollA = roll2d6();
  let rollB = roll2d6();
  while (rollA === rollB) { rollA = roll2d6(); rollB = roll2d6(); }
  const firstSide: "a" | "b" = rollA > rollB ? "a" : "b";
  push(0, "Setup", `Initiative roll-off: A rolls ${rollA}, B rolls ${rollB} — Army ${firstSide.toUpperCase()} has the initiative and acts first each round.`);
  const sideOrder: ["a", "b"] | ["b", "a"] = firstSide === "a" ? ["a", "b"] : ["b", "a"];

  const state: LiveBattleState = {
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
  };

  return { state, log };
}

function computeDecisionsForStep(state: LiveBattleState, step: RoundStep): PendingDecision[] {
  if (step.side !== state.playerSide) return [];
  const mine = aliveUnits(sideUnits(state, step.side));
  const theirs = aliveUnits(sideUnits(state, step.side === "a" ? "b" : "a"));

  if (step.kind === "movement") {
    return mine
      .filter((u) => !theirs.some((e) => e.zone === u.zone))
      .map((u) => ({ armyUnitId: u.armyUnitId, unitName: u.name, zone: u.zone, kind: "movement" as const }));
  }
  if (step.kind === "shooting") {
    const out: PendingDecision[] = [];
    for (const u of mine) {
      if (!u.weapons.some((w) => w.type === "ranged")) continue;
      const targets = validRangedTargets(u, theirs);
      if (targets.length > 0) {
        out.push({
          armyUnitId: u.armyUnitId,
          unitName: u.name,
          zone: u.zone,
          kind: "shooting",
          targets: targets.map((t) => ({ armyUnitId: t.armyUnitId, name: t.name })),
        });
      }
    }
    return out;
  }
  return [];
}

function resolveStep(
  state: LiveBattleState,
  step: RoundStep,
  decisions: Record<string, string> | undefined,
  push: (round: number, phase: string, message: string) => void
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
      const enemyHere = theirs.some((e) => e.zone === u.zone);
      u.engaged = enemyHere;
      if (enemyHere) continue;
      const choice = isPlayer ? decisions?.[String(u.armyUnitId)] : "advance";
      if (choice === "hold") {
        push(state.round, "Movement", `${u.name} holds position at ${u.zone}.`);
        continue;
      }
      const from = u.zone;
      u.zone = stepToward(u.zone, "mid", side);
      push(state.round, "Movement", `${u.name} advances from ${from} to ${u.zone}.`);
    }
    return;
  }

  if (step.kind === "shooting") {
    const side = step.side!;
    const mine = aliveUnits(sideUnits(state, side));
    const theirs = aliveUnits(sideUnits(state, side === "a" ? "b" : "a"));
    const isPlayer = side === state.playerSide;
    for (const u of mine) {
      if (!u.weapons.some((w) => w.type === "ranged")) continue;
      const targets = validRangedTargets(u, theirs);
      if (targets.length === 0) continue;

      let target: SimUnit | null;
      if (isPlayer) {
        const choice = decisions?.[String(u.armyUnitId)];
        if (!choice || choice === "hold_fire") {
          if (choice === "hold_fire") push(state.round, "Shooting", `${u.name} holds fire.`);
          continue;
        }
        target = targets.find((t) => String(t.armyUnitId) === choice) ?? null;
        if (!target) continue;
      } else {
        target = aiPickTarget(targets);
        if (!target) continue;
      }
      resolveAttacks(u, target, u.weapons.filter((w) => w.type === "ranged"), (msg) => push(state.round, "Shooting", msg));
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
      const target = theirs.find((e) => e.zone === u.zone);
      if (!target) continue;
      resolveAttacks(u, target, melee, (msg) => push(state.round, "Fight", msg));
    }
    return;
  }

  // scoring
  const mission = MISSIONS.find((m) => m.key === state.missionKey) ?? MISSIONS[0];
  if (!mission.scoringRounds.includes(state.round)) return;
  for (const obj of mission.objectives) {
    const ocA = aliveUnits(state.unitsA).filter((u) => u.zone === obj.zone).reduce((s, u) => s + (u.battleShocked ? 0 : u.oc), 0);
    const ocB = aliveUnits(state.unitsB).filter((u) => u.zone === obj.zone).reduce((s, u) => s + (u.battleShocked ? 0 : u.oc), 0);
    if (ocA > ocB) {
      state.vpA += obj.vp;
      push(state.round, "Scoring", `Army A controls ${obj.zone} (OC ${ocA} vs ${ocB}) — +${obj.vp}VP (A: ${state.vpA}).`);
    } else if (ocB > ocA) {
      state.vpB += obj.vp;
      push(state.round, "Scoring", `Army B controls ${obj.zone} (OC ${ocB} vs ${ocA}) — +${obj.vp}VP (B: ${state.vpB}).`);
    } else {
      push(state.round, "Scoring", `${obj.zone} is contested (OC ${ocA} vs ${ocB}) — no one scores.`);
    }
  }
}

function finishBattle(state: LiveBattleState, push: (round: number, phase: string, message: string) => void): void {
  state.winner = state.vpA === state.vpB ? "draw" : state.vpA > state.vpB ? "a" : "b";
  push(0, "Result", `Final score — Army A: ${state.vpA}VP, Army B: ${state.vpB}VP. ${state.winner === "draw" ? "Draw." : `Army ${state.winner.toUpperCase()} wins.`}`);
}

function checkGameOver(state: LiveBattleState, push: (round: number, phase: string, message: string) => void): boolean {
  const aDead = state.unitsA.every((u) => u.destroyed || modelsAlive(u) === 0);
  const bDead = state.unitsB.every((u) => u.destroyed || modelsAlive(u) === 0);
  if (!aDead && !bDead) return false;
  if (aDead) push(state.round, "Battle round", "Army A has been wiped out.");
  if (bDead) push(state.round, "Battle round", "Army B has been wiped out.");
  finishBattle(state, push);
  return true;
}

/**
 * Advances the battle from wherever it currently sits. If the next step
 * needs the human's input and none was supplied, stops immediately and
 * returns that need. If `decisions` is supplied, applies it to the current
 * (player) step, then keeps auto-resolving — the opponent's whole turn,
 * automatic phases — until either the next player decision point or the
 * battle ends.
 */
export function advanceLiveBattle(state: LiveBattleState, decisions?: Record<string, string>): AdvanceResult {
  const log: SimLogEntry[] = [];
  const push = (round: number, phase: string, message: string) => log.push({ round, phase, message });

  if (state.winner) return { state, log, pending: null };

  for (;;) {
    const steps = buildSteps(state.sideOrder);
    const step = steps[state.stepIndex];

    const pending = computeDecisionsForStep(state, step);
    if (pending.length > 0 && !decisions) {
      return { state, log, pending };
    }

    resolveStep(state, step, decisions, push);
    decisions = undefined; // consumed — only ever applies to the step we were paused on

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
