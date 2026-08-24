import * as cheerio from "cheerio";

export interface MFMPricingTier {
  label: string;
  copies: "all" | "1st-2nd" | "2nd+" | "3rd+";
  entries: { models: number; points: number }[];
}

export interface MFMUnitPoints {
  unitName: string;
  tiers: MFMPricingTier[];
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

function parseTierCopies(label: string): MFMPricingTier["copies"] {
  const u = label.toUpperCase();
  if (u.includes("3RD")) return "3rd+";
  if (u.match(/2ND\s*\+/)) return "2nd+";
  if (u.includes("1ST")) return "1st-2nd";
  return "all";
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
      unit = { unitName, tiers: [] };
      units.push(unit);
    }

    unit.tiers.push({
      label,
      copies: parseTierCopies(label),
      entries,
    });
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

// Pick the right MFM pricing tier for a unit given its copy index (0-based)
export function selectMFMTier(tiers: MFMPricingTier[], copyIndex: number): MFMPricingTier {
  if (tiers.length === 1) return tiers[0];

  const order: MFMPricingTier["copies"][] = ["all", "1st-2nd", "2nd+", "3rd+"];
  const sorted = [...tiers].sort(
    (a, b) => order.indexOf(a.copies) - order.indexOf(b.copies)
  );

  if (copyIndex < 2) {
    return sorted.find((t) => t.copies === "1st-2nd" || t.copies === "all") ?? sorted[0];
  } else {
    return (
      sorted.find((t) => t.copies === "3rd+") ??
      sorted.find((t) => t.copies === "2nd+") ??
      sorted[sorted.length - 1]
    );
  }
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
