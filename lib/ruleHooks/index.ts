import { FOR_THE_GREATER_GOOD, KAUYON } from "./tau";
import type { RuleHooks } from "./types";

export type { HookCtx, RuleHooks, StratagemOffer, StratagemWindow } from "./types";

// Keyed by normalized faction name — applies to every detachment of that faction.
const FACTION_HOOKS: Record<string, RuleHooks> = {
  "t'au empire": FOR_THE_GREATER_GOOD,
  "tau empire": FOR_THE_GREATER_GOOD,
};

// Keyed by normalized detachment name.
const DETACHMENT_HOOKS: Record<string, RuleHooks> = {
  kauyon: KAUYON,
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[’']/g, "'").trim();
}

/** Every rule-hook that applies to a side, given its faction and chosen
 *  detachment (both nullable — most armies have neither implemented). */
export function getRuleHooksForSide(factionName: string | null, detachmentName: string | null): RuleHooks[] {
  const hooks: RuleHooks[] = [];
  const faction = factionName ? FACTION_HOOKS[norm(factionName)] : undefined;
  if (faction) hooks.push(faction);
  const detachment = detachmentName ? DETACHMENT_HOOKS[norm(detachmentName)] : undefined;
  if (detachment) hooks.push(detachment);
  return hooks;
}
