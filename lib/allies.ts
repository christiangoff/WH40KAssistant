import { normalizeFactionName } from "@/lib/text";

// The two "allied Knights" army rules that let an otherwise mono-keyword army
// bring a small number of Knights models from the other Knights faction.
export interface AlliedKnightsRule {
  name: string;
  ruleText: string;
  /** Every model in the army must have this keyword for the rule to apply. */
  requiredKeyword: string;
  /** normalizeFactionName() of the faction the allied models come from. */
  allyFactionKey: string;
  allyFactionLabel: string;
  /** Keyword identifying the "small" allied Knight (up to 3 allowed). */
  smallKeyword: string;
  smallLabel: string;
  /** How the datasheet name of a small Knight tends to start. */
  smallNamePrefix: string;
  titanicLabel: string;
}

export const ALLIED_KNIGHTS_RULES: AlliedKnightsRule[] = [
  {
    name: "Dreadblades",
    ruleText:
      "If every model in your army has the CHAOS keyword, you can include either 1 Titanic Chaos Knights model or up to 3 WAR DOG models in your army, even if they do not have the Faction keyword you selected in the Select Army Faction step. None of these models can be your WARLORD, and they cannot be given Enhancements.",
    requiredKeyword: "CHAOS",
    allyFactionKey: normalizeFactionName("Chaos Knights"),
    allyFactionLabel: "Chaos Knights",
    smallKeyword: "WAR DOG",
    smallLabel: "War Dogs",
    smallNamePrefix: "war dog",
    titanicLabel: "Titanic Chaos Knight",
  },
  {
    name: "Freeblades",
    ruleText:
      "If every model in your army has the IMPERIUM keyword, you can include either one TITANIC IMPERIAL KNIGHTS model or up to three ARMIGER models in your army, even if they do not have the Faction keyword you selected in the Select Army Faction step. None of these models can be your WARLORD, and they cannot be given Enhancements.",
    requiredKeyword: "IMPERIUM",
    allyFactionKey: normalizeFactionName("Imperial Knights"),
    allyFactionLabel: "Imperial Knights",
    smallKeyword: "ARMIGER",
    smallLabel: "Armigers",
    smallNamePrefix: "armiger",
    titanicLabel: "Titanic Imperial Knight",
  },
];

const KNIGHTS_FACTION_KEYS = new Set(ALLIED_KNIGHTS_RULES.map((r) => r.allyFactionKey));

export interface AlliedKnightUnit {
  id: number;
  faction: string | null;
  name: string;
  model_count: number;
  keywords: string[];
}

export interface AlliedKnightsEval {
  rule: AlliedKnightsRule;
  allyUnitIds: number[];
  /** Whether every model in the army satisfies rule.requiredKeyword. */
  everyModelHasKeyword: boolean;
  /** Unit names lacking the required keyword. */
  offenders: string[];
  titanicCount: number;
  smallCount: number;
  ok: boolean;
  warnings: string[];
}

const hasKw = (u: AlliedKnightUnit, kw: string) =>
  u.keywords.some((k) => k.toUpperCase() === kw);

// Returns which allied-Knights rule applies to this army and how well it's
// being followed, or null if the concept doesn't apply.
export function evaluateAlliedKnights(
  armyFactionName: string | null,
  units: AlliedKnightUnit[],
): AlliedKnightsEval | null {
  if (units.length === 0) return null;
  const armyKey = normalizeFactionName(armyFactionName ?? "");
  if (KNIGHTS_FACTION_KEYS.has(armyKey)) return null; // a Knights army uses its faction normally

  const isAlly = (u: AlliedKnightUnit, r: AlliedKnightsRule) =>
    normalizeFactionName(u.faction ?? "") === r.allyFactionKey;

  // Prefer a rule whose allied faction is already present in the army;
  // otherwise fall back to "every model has the keyword".
  const rule =
    ALLIED_KNIGHTS_RULES.find((r) => units.some((u) => isAlly(u, r))) ??
    ALLIED_KNIGHTS_RULES.find((r) => units.every((u) => hasKw(u, r.requiredKeyword)));
  if (!rule) return null;

  const allies = units.filter((u) => isAlly(u, rule));
  const offenders = units
    .filter((u) => !isAlly(u, rule) && !hasKw(u, rule.requiredKeyword))
    .map((u) => u.name);
  const everyModelHasKeyword = offenders.length === 0;

  const isSmall = (u: AlliedKnightUnit) =>
    hasKw(u, rule.smallKeyword) || u.name.toLowerCase().startsWith(rule.smallNamePrefix);
  const smallCount = allies.filter(isSmall).reduce((n, u) => n + u.model_count, 0);
  const titanicCount = allies.filter((u) => !isSmall(u)).reduce((n, u) => n + u.model_count, 0);

  const withinLimit =
    (titanicCount <= 1 && smallCount === 0) || (titanicCount === 0 && smallCount <= 3);

  const warnings: string[] = [];
  if (offenders.length > 0) {
    warnings.push(
      `Needs every model to have the ${rule.requiredKeyword} keyword — these don't: ${offenders.join(", ")}`,
    );
  }
  if (titanicCount > 0 && smallCount > 0) {
    warnings.push(`Take either a ${rule.titanicLabel} or ${rule.smallLabel} — not both.`);
  } else if (titanicCount > 1) {
    warnings.push(`Only 1 ${rule.titanicLabel} is allowed.`);
  } else if (smallCount > 3) {
    warnings.push(`Up to 3 ${rule.smallLabel} are allowed.`);
  }

  return {
    rule,
    allyUnitIds: allies.map((u) => u.id),
    everyModelHasKeyword,
    offenders,
    titanicCount,
    smallCount,
    ok: everyModelHasKeyword && withinLimit,
    warnings,
  };
}

// ─── Daemonic Pact: Chaos Knights / Heretic Astartes armies allying in ────────
// Chaos Daemons (Legiones Daemonica) units. From the Chaos Daemons codex's
// DAEMONIC PACT army rule (not a Chaos Knights rule — it lives on the Daemons
// side, mirroring Dreadblades/Freeblades but points-capped by battle size and
// keyed off a Battleline "tax" per Chaos God rather than a titanic/small count).
const DAEMONIC_PACT_RULE_TEXT =
  "If every model from your army has the CHAOS KNIGHTS or HERETIC ASTARTES keyword, you can include Legiones Daemonica units in your army, even if they do not have the Faction keyword you selected in the Select Army Faction step. The combined points cost of such units you can include is up to 25% of your army's points limit (Incursion 250pts / Strike Force 500pts / Onslaught 750pts). None of these models can be your Warlord, and they cannot be given Enhancements. In addition, for each of the Khorne, Tzeentch, Nurgle and Slaanesh keywords, the number of non-Battleline units with that keyword you include this way cannot be greater than the number of Battleline units with that keyword you include this way.";

const DAEMONIC_PACT_REQUIRED_KEYWORDS = ["CHAOS KNIGHTS", "HERETIC ASTARTES"];
const DAEMON_GODS = ["KHORNE", "TZEENTCH", "NURGLE", "SLAANESH"];
const CHAOS_DAEMONS_FACTION_KEY = normalizeFactionName("Chaos Daemons");

export interface DaemonicPactUnit {
  id: number;
  faction: string | null;
  name: string;
  model_count: number;
  keywords: string[];
  points: number;
}

export interface DaemonicPactGodTax {
  god: string;
  battlelineUnits: number;
  nonBattlelineUnits: number;
  ok: boolean;
}

export interface DaemonicPactEval {
  ruleText: string;
  allyUnitIds: number[];
  /** Whether every non-ally model in the army has CHAOS KNIGHTS or HERETIC ASTARTES. */
  everyModelHasKeyword: boolean;
  offenders: string[];
  pointsCap: number;
  pointsUsed: number;
  /** Per-Chaos-God Battleline tax, only for gods actually represented among the allies. */
  godTax: DaemonicPactGodTax[];
  ok: boolean;
  warnings: string[];
}

const hasDaemonKw = (u: DaemonicPactUnit, kw: string) =>
  u.keywords.some((k) => k.toUpperCase() === kw);

// Returns the Daemonic Pact evaluation for this army, or null if the rule
// doesn't apply (a Chaos Daemons army uses its own faction normally, and an
// army with no Daemons allies and no qualifying keyword has no reason to see this).
export function evaluateDaemonicPact(
  armyFactionName: string | null,
  units: DaemonicPactUnit[],
  pointLimit: number,
): DaemonicPactEval | null {
  if (units.length === 0) return null;
  const armyKey = normalizeFactionName(armyFactionName ?? "");
  if (armyKey === CHAOS_DAEMONS_FACTION_KEY) return null;

  const isAlly = (u: DaemonicPactUnit) => normalizeFactionName(u.faction ?? "") === CHAOS_DAEMONS_FACTION_KEY;
  const qualifiesWithoutAlly = (u: DaemonicPactUnit) =>
    DAEMONIC_PACT_REQUIRED_KEYWORDS.some((kw) => hasDaemonKw(u, kw));

  const anyAllies = units.some(isAlly);
  const everyoneQualifies = units.every((u) => isAlly(u) || qualifiesWithoutAlly(u));
  if (!anyAllies && !everyoneQualifies) return null;

  const allies = units.filter(isAlly);
  const offenders = units.filter((u) => !isAlly(u) && !qualifiesWithoutAlly(u)).map((u) => u.name);
  const everyModelHasKeyword = offenders.length === 0;

  const pointsCap = Math.floor(pointLimit * 0.25);
  const pointsUsed = allies.reduce((sum, u) => sum + u.points, 0);

  const godTax: DaemonicPactGodTax[] = DAEMON_GODS.map((god) => {
    const godAllies = allies.filter((u) => hasDaemonKw(u, god));
    const battlelineUnits = godAllies.filter((u) => hasDaemonKw(u, "BATTLELINE")).length;
    const nonBattlelineUnits = godAllies.length - battlelineUnits;
    return { god, battlelineUnits, nonBattlelineUnits, ok: nonBattlelineUnits <= battlelineUnits };
  }).filter((g) => g.battlelineUnits > 0 || g.nonBattlelineUnits > 0);

  const warnings: string[] = [];
  if (offenders.length > 0) {
    warnings.push(
      `Needs every model to have the CHAOS KNIGHTS or HERETIC ASTARTES keyword — these don't: ${offenders.join(", ")}`,
    );
  }
  if (pointsUsed > pointsCap) {
    warnings.push(`Allied Chaos Daemons cost ${pointsUsed}pts — the cap for a ${pointLimit}pt army is ${pointsCap}pts (25%).`);
  }
  for (const g of godTax) {
    if (!g.ok) {
      warnings.push(
        `${g.nonBattlelineUnits} non-Battleline ${g.god} unit${g.nonBattlelineUnits === 1 ? "" : "s"} but only ${g.battlelineUnits} Battleline — take at least ${g.nonBattlelineUnits} Battleline ${g.god} unit${g.nonBattlelineUnits === 1 ? "" : "s"}.`,
      );
    }
  }

  return {
    ruleText: DAEMONIC_PACT_RULE_TEXT,
    allyUnitIds: allies.map((u) => u.id),
    everyModelHasKeyword,
    offenders,
    pointsCap,
    pointsUsed,
    godTax,
    ok: everyModelHasKeyword && pointsUsed <= pointsCap && godTax.every((g) => g.ok),
    warnings,
  };
}
