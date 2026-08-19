"use client";

import { useEffect, useState, useContext, createContext } from "react";

// Shared across match page and army builder: both render unit stat blocks (via
// StatBlock) and rule/stratagem text that should let a player tap a keyword or
// ability name to see its definition, without either page re-implementing the
// glossary data or the click-to-define wiring.

export const GLOSSARY: { term: string; category: string; description: string }[] = [
  // Weapon abilities
  { term: "ANTI-[X] N+",         category: "Weapon", description: "Against units with keyword X, an unmodified wound roll of N+ is a Critical Wound (triggering abilities like Devastating Wounds), regardless of Strength vs Toughness." },
  { term: "ASSAULT",             category: "Weapon", description: "Lets a unit that Advanced this turn still shoot — but that phase it can only make attacks with its [ASSAULT] weapons." },
  { term: "BLAST",               category: "Weapon", description: "Add one extra attack die (or X extra, for [BLAST X]) for every 5 models in the target unit, rounding down." },
  { term: "CLOSE-QUARTERS",      category: "Weapon", description: "Lets an engaged unit shoot with just its [CLOSE-QUARTERS] weapons at a unit it's fighting. [PISTOL] is the same ability under its old name." },
  { term: "DEVASTATING WOUNDS",  category: "Weapon", description: "A Critical Wound (not necessarily an unmodified 6 — Anti-X can trigger it too) skips normal damage and inflicts mortal wounds equal to the weapon's Damage instead." },
  { term: "EXTRA ATTACKS",       category: "Weapon", description: "Must be selected alongside one other melee weapon when the model fights — free additional attacks on top of its normal weapon, not a replacement for it." },
  { term: "FIGHTS FIRST",        category: "Weapon", description: "A unit where every model has this ability fights before other (non-Fights First) units in the Fight phase." },
  { term: "HAZARDOUS",           category: "Weapon", description: "After a unit shoots or fights, make one hazard roll per [HAZARDOUS] weapon selected: on a 1-2, the unit suffers 1 mortal wound (3 if every model in it is a Monster/Vehicle)." },
  { term: "HEAVY",               category: "Weapon", description: "+1 to hit if the bearer's unit is unengaged, wasn't set up on the battlefield this turn, and no model in it moved more than 3\" this turn." },
  { term: "IGNORES COVER",       category: "Weapon", description: "The target gets no benefit of cover against this attack, even from other abilities that would normally grant it (e.g. Stealth)." },
  { term: "INDIRECT FIRE",       category: "Weapon", description: "Can target units it can't see. The target gets the benefit of cover against that attack, and the hit roll can't be re-rolled." },
  { term: "LANCE",               category: "Weapon", description: "+1 to the wound roll if the bearer's unit made a Charge move this turn." },
  { term: "LETHAL HITS",         category: "Weapon", description: "On a Critical Hit, you may choose to skip the wound roll and score an automatic wound instead." },
  { term: "MELTA X",             category: "Weapon", description: "If the target was within half range when targeted, add X to the weapon's Damage characteristic." },
  { term: "ONE SHOT",            category: "Weapon", description: "This weapon can only be selected to make attacks with once per battle." },
  { term: "PISTOL",              category: "Weapon", description: "Identical to [CLOSE-QUARTERS] — see that entry. Older datasheets/weapons still use the name Pistol." },
  { term: "PRECISION",           category: "Weapon", description: "When allocating these attacks, you can choose to allocate to a visible CHARACTER model in the target unit instead of the closest model." },
  { term: "RAPID FIRE X",        category: "Weapon", description: "Add X extra attack dice if the target was within half the weapon's range in the Select Targets step." },
  { term: "SUSTAINED HITS X",    category: "Weapon", description: "On a Critical Hit, score X additional hits on top of the one that triggered it." },
  { term: "TORRENT",             category: "Weapon", description: "Automatically hits — no hit roll is made." },
  { term: "TWIN-LINKED",         category: "Weapon", description: "Re-roll the wound roll for attacks made with this weapon." },
  // Unit / army abilities
  { term: "DEEP STRIKE",         category: "Unit",   description: "On an ingress move, can be set up anywhere more than 8\" from all enemy units — even inside your opponent's deployment zone." },
  { term: "FEEL NO PAIN X+",     category: "Unit",   description: "Each time this model would lose a wound, roll one D6: on an X+, that wound isn't lost." },
  { term: "INFILTRATORS",        category: "Unit",   description: "During deployment, can be set up anywhere more than 8\" from the enemy deployment zone and all enemy units." },
  { term: "STEALTH",             category: "Unit",   description: "The unit has the benefit of cover against every ranged attack that targets it, regardless of terrain." },
  { term: "SCOUTS X\"",          category: "Unit",   description: "In the Resolve Pre-battle Abilities step, a unit wholly within its deployment zone can make a Normal Move of up to X\" (ending more than 8\" from all enemy units) — or, from Strategic Reserves, set up anywhere in its deployment zone instead." },
  { term: "LONE OPERATIVE",      category: "Unit",   description: "Not visible to enemy models — and can't be targeted by [INDIRECT FIRE] weapons — unless the enemy is within 12\" (or the ability's stated distance). Attached units lose this protection." },
  // Datasheet tags & keywords (battlefield role and other keywords printed on a unit's datasheet)
  { term: "INFANTRY",            category: "Keyword", description: "Battlefield role for foot troops — the most common role. No rule of its own, but other abilities (Scouts, Infiltrators, etc.) are frequently written to only apply to Infantry units." },
  { term: "VEHICLE",             category: "Keyword", description: "Battlefield role for war machines. During a Normal or Advance move, VEHICLE models can move through friendly and enemy models — except other MONSTER/VEHICLE models." },
  { term: "MONSTER",             category: "Keyword", description: "Battlefield role for towering creatures. Shares VEHICLE's move-through-models rule during Normal/Advance moves — except other MONSTER/VEHICLE models." },
  { term: "CHARACTER",           category: "Keyword", description: "Battlefield role for named heroes and leaders. Only CHARACTER units can be your Warlord or receive an Enhancement; many can lead a bodyguard unit to form an attached unit." },
  { term: "BATTLELINE",          category: "Keyword", description: "Core troop choices. The unit limit for Battleline (and Dedicated Transport) units is double the normal per-datasheet limit for your battle size." },
  { term: "DEDICATED TRANSPORT", category: "Keyword", description: "A unit's assigned transport. Must have a friendly unit embarked within it by the end of Declare Battle Formations, or it's destroyed. Its unit limit is doubled, same as Battleline." },
  { term: "TRANSPORT",           category: "Keyword", description: "Has a transport capacity listed on its datasheet — other eligible units can embark inside it instead of deploying or moving normally." },
  { term: "FLY",                 category: "Keyword", description: "Can declare \"take to the skies\" on a Normal, Advance, Fall Back or Charge move: subtract 2\" from the max distance, but the unit can then move through all terrain and all models — even enemies — and ignores vertical distance." },
  { term: "EPIC HERO",           category: "Keyword", description: "Always limited to 1 per army, regardless of battle size." },
  { term: "GRENADES / EXPLOSIVES", category: "Keyword", description: "Grants the Explosives Core Stratagem (1CP): one unengaged model in the unit targets a visible enemy unit within 8\" and rolls 6D6 — each 4+ deals 1 mortal wound. The unit must not have Advanced this turn. Older datasheets print this keyword as \"Grenades\"; same keyword, current stratagem name is Explosives." },
  { term: "MARKERLIGHT",         category: "Keyword", description: "T'au targeting-laser keyword. Weapons/abilities that apply Markerlight tokens make the marked target easier for the rest of the army to hit — the exact bonus is defined by whichever ability grants it (e.g. For the Greater Good)." },
  { term: "BATTLESUIT",          category: "Keyword", description: "T'au powered-armour keyword. Several T'au enhancements and detachments (e.g. Retaliation Cadre, Experimental Prototype Cadre) are restricted to BATTLESUIT models only." },
  // Core stats
  { term: "BS (Ballistic Skill)", category: "Stat",  description: "The roll needed to hit with ranged weapons. E.g. BS 4+ means you need a 4 or higher on a D6." },
  { term: "WS (Weapon Skill)",   category: "Stat",   description: "The roll needed to hit with melee weapons." },
  { term: "OC (Objective Control)", category: "Stat", description: "The number of models × OC value counts towards controlling an objective marker." },
  { term: "CP (Command Points)", category: "Stat",   description: "Spent to use Stratagems. Gained at the start of each Command phase (typically 1 per turn)." },
  { term: "AP (Armour Penetration)", category: "Stat", description: "Reduces the target's Save roll. AP -1 means the target saves on 1 worse; AP -3 means 3 worse." },
  { term: "D (Damage)",          category: "Stat",   description: "Wounds removed per successful attack. Multi-damage weapons can wipe multi-wound models in one hit." },
];

// ─── Click-to-define: auto-link glossary terms found in stratagem/rule/keyword text ───
// "Stat" entries (BS, AP, D, ...) are excluded — they're 1-2 letter abbreviations
// that would false-positive constantly in prose (e.g. "D" matching inside random
// words), and they only ever appear in the structured stat-block UI, not free text.
// A few terms carry a placeholder (MELTA X, SUSTAINED HITS X, ANTI-[X] N+, ...). Real
// text usually has an actual number instead (e.g. "MELTA 2"), but rules text also
// frequently re-references the bare ability name after already stating its value once
// (e.g. "a [SUSTAINED HITS] weapon") — so the numeric part is optional, not required.
const PARAMETERIZED_GLOSSARY_PATTERNS: Record<string, string> = {
  "ANTI-[X] N+": "ANTI-[A-Z ]+(?:\\s*\\d+\\+)?",
  "MELTA X": "MELTA(?:\\s*\\d+)?",
  "RAPID FIRE X": "RAPID FIRE(?:\\s*\\d+)?",
  "SUSTAINED HITS X": "SUSTAINED HITS(?:\\s*\\d+)?",
  "FEEL NO PAIN X+": "FEEL NO PAIN(?:\\s*\\d+\\+)?",
  "SCOUTS X\"": "SCOUTS(?:\\s*\\d+\")?",
  "GRENADES / EXPLOSIVES": "GRENADES|EXPLOSIVES",
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// \b...(?:s)?\b: word-boundary anchored so e.g. "CHARACTER" can't match inside
// "characteristic", but a simple trailing plural ("VEHICLES") still highlights whole.
// Also doubles as an exact-match lookup: a keyword badge's text (e.g. "INFANTRY") is
// itself run through this same scan rather than a plain GLOSSARY.find, since some
// datasheet keywords include a value inline (e.g. weapon ability badges like
// "SUSTAINED HITS 1") that only the parameterized patterns know how to recognize.
const KEYWORD_TERMS = GLOSSARY
  .filter(g => g.category !== "Stat")
  .map(g => {
    const pattern = PARAMETERIZED_GLOSSARY_PATTERNS[g.term];
    return { term: g.term, pattern: pattern ? `\\b(?:${pattern})` : `\\b${escapeRegExp(g.term)}s?\\b` };
  })
  .sort((a, b) => b.term.length - a.term.length); // longer/more-specific phrases first (defensive)

const KEYWORD_SCAN_REGEX = new RegExp(
  KEYWORD_TERMS.map((k, i) => `(?<t${i}>${k.pattern})`).join("|"),
  "gi"
);

// Splits `text` into plain strings and clickable glossary-term buttons.
function linkifyKeywords(text: string, onOpen: (term: string) => void): React.ReactNode[] {
  if (!text) return [];
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  KEYWORD_SCAN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = KEYWORD_SCAN_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const groups = match.groups ?? {};
    const groupIdx = Object.keys(groups).findIndex(k => groups[k] !== undefined);
    const term = KEYWORD_TERMS[groupIdx]?.term;
    if (term) {
      nodes.push(
        <button
          key={match.index}
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(term); }}
          className="underline decoration-dotted decoration-gray-500 hover:decoration-amber-400 hover:text-amber-300 transition-colors"
        >
          {match[0]}
        </button>
      );
    } else {
      nodes.push(text.slice(match.index, match.index + match[0].length));
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

// Lets any component open the glossary definition modal for a term without threading
// a callback prop through every intermediate component (stratagem cards, detachment
// rule blocks, weapon ability badges, unit keyword pills, etc. are all several levels
// deep, and StatBlock is shared between the match page and the army builder page).
export const GlossaryModalContext = createContext<(term: string) => void>(() => {});
export function useOpenGlossary() {
  return useContext(GlossaryModalContext);
}

// Wraps a block of stratagem/rule/keyword text, auto-linking any recognized glossary terms.
export function Linkified({ text }: { text: string | null | undefined }) {
  const openGlossary = useOpenGlossary();
  if (!text) return null;
  return <>{linkifyKeywords(text, openGlossary)}</>;
}

export function GlossaryModal({ term, onClose }: { term: string; onClose: () => void }) {
  const entry = GLOSSARY.find(g => g.term === term);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!entry) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-amber-700 rounded-lg max-w-sm w-full p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-amber-400 font-bold font-mono">{entry.term}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              entry.category === "Weapon"  ? "bg-blue-900 text-blue-300" :
              entry.category === "Unit"    ? "bg-green-900 text-green-300" :
              entry.category === "Keyword" ? "bg-purple-900 text-purple-300" :
                                              "bg-gray-700 text-gray-400"
            }`}>{entry.category}</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none shrink-0">✕</button>
        </div>
        <p className="text-gray-300 text-sm leading-relaxed">{entry.description}</p>
      </div>
    </div>
  );
}

// Simple state holder for a page's single glossary modal instance: spreads
// `{ contextValue, modal }` — put `contextValue` on a GlossaryModalContext.Provider
// and render `{modal}` once, near the root, so any descendant's <Linkified> or
// keyword click can open it.
export function useGlossaryModalState() {
  const [term, setTerm] = useState<string | null>(null);
  const modal = term ? <GlossaryModal term={term} onClose={() => setTerm(null)} /> : null;
  return { contextValue: setTerm, modal };
}
