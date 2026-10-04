import type { AttackContext } from "@/lib/battleSim";
import type { SpatialBattleState, SpatialUnit } from "@/lib/battleSimSpatial";

// ─────────────────────────────────────────────────────────────────────────
// A small, explicit, opt-in registry — not a generic rules interpreter.
// Each entry hand-implements one detachment (or army rule) exactly as
// scraped from Wahapedia (detachments.rule_text / stratagems.effect_text —
// see lib/factionSync.ts), wired into named events the spatial engine
// already exposes. A side whose detachment has no entry here plays with the
// engine's generic behavior only (still improved by lib/ruleKeywords.ts,
// which applies to every weapon regardless of detachment).
// ─────────────────────────────────────────────────────────────────────────

export interface HookCtx {
  state: SpatialBattleState;
  side: "a" | "b";
}

export type StratagemWindow = "pre-shoot";

export interface StratagemOffer {
  /** Stable id for this offer instance, e.g. "point-blank-ambush:42". */
  key: string;
  name: string;
  cp: number;
  description: string;
}

export interface RuleHooks {
  /** Matches a detachment's `name` column (case-insensitive). */
  key: string;
  /** Shown on the board's "Real rules: <label>" badge. */
  label: string;

  /**
   * Called once at the start of this side's Shooting step, before any unit
   * in it fires — lets the hook resolve phase-scoped mechanics (e.g. T'au's
   * Observer/Spotted units) from the human player's `decisions` for units
   * that opted in via a non-target sentinel value (see lib/ruleHooks/tau.ts).
   */
  onShootingPhaseStart?(ctx: HookCtx, decisions: Record<string, string> | undefined, log: (msg: string) => void): void;

  /** Can this unit take the hook's phase-start action (e.g. become an
   *  Observer)? Checked while computing this Shooting step's decisions, so
   *  the UI can offer the option before onShootingPhaseStart resolves it. */
  spotEligible?(ctx: HookCtx, unit: SpatialUnit): boolean;

  /** Adjusts the AttackContext just before resolveAttacks() runs for one attacker→defender weapon volley. */
  modifyAttackContext?(ctx: HookCtx, attacker: SpatialUnit, defender: SpatialUnit, base: AttackContext): AttackContext;

  /** Extra CP-spend options offered to the human player at a given decision window, for one of their units. */
  offerStratagems?(ctx: HookCtx, window: StratagemWindow, unit: SpatialUnit): StratagemOffer[];

  /** Applies a chosen stratagem's effect (already CP-checked/deducted by the caller). Returns an AttackContext patch to merge in, or void if the stratagem doesn't affect AttackContext directly. */
  applyStratagem?(ctx: HookCtx, offerKey: string, unit: SpatialUnit): AttackContext | void;
}
