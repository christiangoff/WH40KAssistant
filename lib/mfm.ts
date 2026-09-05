import * as cheerio from "cheerio";

export interface MFMPricingTier {
  label: string;
  copies: "all" | "1st-2nd" | "2nd+" | "3rd+";
  /**
   * 1-based index of the first army copy this tier applies to, parsed from the
   * MFM label. e.g. "YOUR 1ST TO 3RD UNITS COST" → 1, "YOUR 4TH + UNIT COSTS" → 4.
   * Undefined for older cached stats scraped before this field existed.
   */
  minCopy?: number;
  entries: { models: number; points: number }[];
}

export interface MFMWargearCost {
  /** Weapon/wargear name, e.g. "Twin lascannon" (the "per " prefix stripped). */
  weapon: string;
  /** Extra points charged for each copy of this wargear the unit is equipped with. */
  points: number;
}

export interface MFMUnitPoints {
  unitName: string;
  tiers: MFMPricingTier[];
  /** Costed weapon/wargear upgrades from the MFM "WARGEAR OPTIONS" block. */
  wargear: MFMWargearCost[];
}

// Canonical Wahapedia faction name → MFM URL slug
const FACTION_SLUG_MAP: Record<string, string> = {
  "Adepta Sororitas": "adepta-sororitas",
  "Adeptus Custodes": "adeptus-custodes",
  "Adeptus Mechanicus": "adeptus-mechanicus",
  "Aeldari": "aeldari",
  "Astra Militarum": "astra-militarum",
  "Black Templars": "black-templars",
  "Blood Angels": "blood-angels",
  "Chaos Daemons": "chaos-daemons",
  "Chaos Knights": "chaos-knights",
  "Chaos Space Marines": "chaos-space-marines",
  "Chaos Titan Legions": "chaos-titan-legions",
  "Dark Angels": "dark-angels",
  "Death Guard": "death-guard",
  "Deathwatch": "deathwatch",
  "Drukhari": "drukhari",
  "Emperor's Children": "emperors-children",
  "Genestealer Cults": "genestealer-cults",
  "Grey Knights": "grey-knights",
  "Imperial Agents": "imperial-agents",
  "Imperial Knights": "imperial-knights",
  "Leagues of Votann": "leagues-of-votann",
  "Necrons": "necrons",
  "Orks": "orks",
  "Space Marines": "space-marines",
  "Space Wolves": "space-wolves",
  "T'au Empire": "tau-empire",
  "Tau Empire": "tau-empire",
  "T Au Empire": "tau-empire",       // Wahapedia: t-au-empire → "T Au Empire"
  "Emperors Children": "emperors-children", // Wahapedia: emperors-children (no apostrophe)
  "Leagues Of Votann": "leagues-of-votann", // title-case "Of" capitalised
  "Thousand Sons": "thousand-sons",
  "Titan Legions": "titan-legions",
  "Tyranids": "tyranids",
  "World Eaters": "world-eaters",
};

function factionToSlug(faction: string): string | null {
  if (FACTION_SLUG_MAP[faction]) return FACTION_SLUG_MAP[faction];
  const slug = faction
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return slug || null;
}

// Parse an MFM tier label into a coarse `copies` bucket plus the 1-based index of
// the first army copy the tier covers.
//
// MFM labels vary in form:
//   "YOUR 1ST TO 2ND UNITS COST"  → range starting at 1
//   "YOUR 1ST TO 3RD UNITS COST"  → range starting at 1 (Devilfish, Hammerhead)
//   "YOUR 3RD + UNIT COSTS"       → open-ended starting at 3
//   "YOUR 4TH + UNIT COSTS"       → open-ended starting at 4 (Devilfish)
// The bucket must be driven by where the range *starts*, not by whether "3RD"
// appears anywhere in the text — otherwise "1ST TO 3RD" is misread as the
// expensive later tier.
export function parseTier(label: string): { copies: MFMPricingTier["copies"]; minCopy: number } {
  const u = label.toUpperCase();
  const ordinals = [...u.matchAll(/(\d+)\s*(?:ST|ND|RD|TH)\b/g)].map((m) =>
    parseInt(m[1], 10)
  );
  if (ordinals.length === 0) return { copies: "all", minCopy: 1 };

  const minCopy = Math.min(...ordinals);
  const copies: MFMPricingTier["copies"] =
    minCopy <= 1 ? "1st-2nd" : minCopy === 2 ? "2nd+" : "3rd+";
  return { copies, minCopy };
}

// The MFM site uses React Server Components streaming:
// - <template id="P:N"> placeholders throughout the page
// - <div hidden id="S:N">...</div> with the actual resolved content
// This is used for BOTH points values (a "Y pts" span) and unit name headers (a
// div containing the name) — earlier versions of the site rendered the unit name
// as a static div, but it's now streamed the same way as points, so both need to
// be resolved through this same P:/S: text map rather than just points.
function buildTemplateTextMap($: ReturnType<typeof cheerio.load>): Map<string, string> {
  const map = new Map<string, string>();
  $('[hidden][id^="S:"]').each((_, el) => {
    const sId = $(el).attr("id"); // e.g. "S:3"
    if (!sId) return;
    const pId = sId.replace(/^S:/, "P:"); // "P:3"
    map.set(pId, $(el).text().trim());
  });
  return map;
}

// Parse all unit cards from the page HTML.
// Unit pricing lists use `ul.leaders.bg-yellow`; formation enhancement lists use `ul.leaders` (no bg-yellow).
function parseUnitsFromHTML(html: string): MFMUnitPoints[] {
  const $ = cheerio.load(html);
  const templateMap = buildTemplateTextMap($);
  const units: MFMUnitPoints[] = [];
  const seenNames = new Set<string>();

  // Each pricing list (`ul.leaders.bg-yellow`) belongs to one (unit, tier) pair.
  // Walk up from the pricing list to find the tier label and unit name.
  $("ul.leaders.bg-yellow").each((_, ul) => {
    const $ul = $(ul);

    // The tier label is the immediately preceding sibling div with bg-slate-200/bg-slate-600
    const tierLabelEl = $ul.prev("div");
    const label = tierLabelEl.text().trim();
    if (!label.toUpperCase().includes("UNIT")) return;

    // Parse entries from this pricing list
    const entries: { models: number; points: number }[] = [];
    $ul.find("li").each((_, li) => {
      const modelText = $(li).find("span").first().text().trim();
      const modelMatch = modelText.match(/(\d+)\s+models?/i);
      if (!modelMatch) return;
      const modelCount = parseInt(modelMatch[1]);

      const template = $(li).find("template");
      const templateId = template.attr("id");
      if (!templateId) return;

      const ptsText = templateMap.get(templateId);
      const ptsMatch = ptsText?.match(/^(\d+)\s*pts?$/i);
      if (!ptsMatch) return;

      entries.push({ models: modelCount, points: parseInt(ptsMatch[1]) });
    });
    if (entries.length === 0) return;

    // Walk up the DOM from the pricing list to find the card container.
    const card = $ul.closest("div.flex.flex-col.space-y-1.m-1");
    if (card.length === 0) return;

    // Unit name: the card's leading <template id="P:N"> (its first child, before the
    // tier divs) resolves through the same P:/S: map to a div containing the name.
    const nameTemplateId = card.children("template").first().attr("id");
    const unitName = nameTemplateId ? (templateMap.get(nameTemplateId) ?? "") : "";
    if (!unitName) return;

    // Add tier to the unit
    let unit = units.find((u) => u.unitName === unitName);
    if (!unit) {
      if (seenNames.has(unitName)) return;
      seenNames.add(unitName);
      unit = { unitName, tiers: [], wargear: [] };
      units.push(unit);
    }

    const { copies, minCopy } = parseTier(label);
    unit.tiers.push({ label, copies, minCopy, entries });
  });

  // Second pass: costed weapon/wargear upgrades. Each card may carry a
  // "WARGEAR OPTIONS" label div followed by a `ul.leaders` (no `bg-yellow`) of
  // `<li><span>per <weapon></span><template id="P:N"></li>` rows, where the
  // template resolves to "N pts" via the same P:/S: map.
  $("div").each((_, div) => {
    const $div = $(div);
    if ($div.children("span").first().text().trim().toUpperCase() !== "WARGEAR OPTIONS") return;

    const card = $div.closest("div.flex.flex-col.space-y-1.m-1");
    if (card.length === 0) return;
    const nameTemplateId = card.children("template").first().attr("id");
    const unitName = nameTemplateId ? (templateMap.get(nameTemplateId) ?? "") : "";
    if (!unitName) return;

    const wargear: MFMWargearCost[] = [];
    $div.parent().find("ul.leaders li").each((_, li) => {
      const weapon = $(li).find("span").first().text().trim().replace(/^per\s+/i, "");
      const templateId = $(li).find("template").attr("id");
      const ptsMatch = templateId ? templateMap.get(templateId)?.match(/(\d+)\s*pts?/i) : null;
      if (weapon && ptsMatch) wargear.push({ weapon, points: parseInt(ptsMatch[1]) });
    });
    if (wargear.length === 0) return;

    let unit = units.find((u) => u.unitName === unitName);
    if (!unit) {
      unit = { unitName, tiers: [], wargear: [] };
      units.push(unit);
      seenNames.add(unitName);
    }
    unit.wargear.push(...wargear);
  });

  return units;
}

// Simple fuzzy name match: 0–1 score
function nameSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const wa = new Set(na.split(" "));
  const wb = new Set(nb.split(" "));
  const intersection = [...wa].filter((w) => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersection / union;
}

// Exported: fetch all unit data for a faction from MFM
export async function fetchMFMFactionData(faction: string): Promise<MFMUnitPoints[]> {
  const slug = factionToSlug(faction);
  if (!slug) return [];

  const url = `https://mfm.warhammer-community.com/en/${slug}`;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) return [];

    const html = await response.text();
    return parseUnitsFromHTML(html);
  } catch {
    return [];
  }
}

// Exported: find points for a specific unit by name within a faction
export async function findMFMUnitPoints(
  unitName: string,
  faction: string
): Promise<MFMUnitPoints | null> {
  const allUnits = await fetchMFMFactionData(faction);
  if (allUnits.length === 0) return null;

  let bestScore = 0;
  let bestUnit: MFMUnitPoints | null = null;

  for (const unit of allUnits) {
    const score = nameSimilarity(unitName, unit.unitName);
    if (score > bestScore) {
      bestScore = score;
      bestUnit = unit;
    }
  }

  return bestScore >= 0.5 ? bestUnit : null;
}

// Re-derive `copies` / `minCopy` from the label. stats_json cached before this
// parsing was fixed carries a stale `copies` bucket and no `minCopy`, so
// normalize every tier on read rather than trusting the stored fields.
function normalizeTier(tier: MFMPricingTier): MFMPricingTier {
  const { copies, minCopy } = parseTier(tier.label);
  return { ...tier, copies, minCopy };
}

function tierMinCopy(tier: MFMPricingTier): number {
  return parseTier(tier.label).minCopy;
}

// The cheapest / earliest tier — what a lone copy of the unit costs.
export function selectPrimaryMFMTier(tiers: MFMPricingTier[]): MFMPricingTier {
  return normalizeTier([...tiers].sort((a, b) => tierMinCopy(a) - tierMinCopy(b))[0]);
}

// Pick the right MFM pricing tier for a unit given its copy index (0-based):
// the highest-starting tier that still covers this copy.
export function selectMFMTier(tiers: MFMPricingTier[], copyIndex: number): MFMPricingTier {
  if (tiers.length === 1) return normalizeTier(tiers[0]);

  const copyNumber = copyIndex + 1;
  const sorted = [...tiers].sort((a, b) => tierMinCopy(a) - tierMinCopy(b));
  let chosen = sorted[0];
  for (const t of sorted) {
    if (tierMinCopy(t) <= copyNumber) chosen = t;
  }
  return normalizeTier(chosen);
}

// Get the total points for a unit from an MFM tier based on model count
export function getPointsFromTier(
  tier: MFMPricingTier,
  modelCount: number
): number {
  if (tier.entries.length === 0) return 0;
  const sorted = [...tier.entries].sort((a, b) => a.models - b.models);
  const matching = sorted.filter((e) => e.models <= modelCount);
  if (matching.length > 0) return matching[matching.length - 1].points;
  return sorted[0].points;
}
