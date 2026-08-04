import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { MFMPricingTier } from "./mfm";

export interface WeaponProfile {
  name: string;
  type: "ranged" | "melee";
  range: string;
  attacks: string;
  bsWs: string;
  strength: string;
  ap: string;
  damage: string;
  abilities: string;
}

export interface PointsEntry {
  models: number;
  points: number;
}

export interface Stratagem {
  name: string;
  cp: string;
  type: string;
  legend: string;
  when: string;
  target: string;
  effect: string;
  restrictions?: string;
}

export interface UnitStats {
  name: string;
  faction: string;
  M: string;
  T: string;
  Sv: string;
  W: string;
  Ld: string;
  OC: string;
  invuln?: string;
  keywords: string[];
  abilities: { name: string; description: string }[];
  weapons: WeaponProfile[];
  wargear_options: string[];
  points_per_model?: number;
  points_table: PointsEntry[];
  /** Pricing tiers sourced from the Munitorum Field Manual (mfm.warhammer-community.com). */
  mfm_tiers?: MFMPricingTier[];
}

export async function scrapeWahapediaUnit(url: string): Promise<UnitStats> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      Connection: "keep-alive",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Unit name from <title>
  const name = $("title").text().trim() || "Unknown Unit";

  // Faction from URL path e.g. /factions/space-marines/
  let faction = "";
  const urlMatch = url.match(/\/factions\/([^/]+)\//);
  if (urlMatch) {
    faction = urlMatch[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Core stats: dsCharName labels zip with dsCharValue values
  const statNames: string[] = [];
  const statValues: string[] = [];
  $(".dsCharName").each((_, el) => { statNames.push($(el).text().trim()); });
  $(".dsCharValue").each((_, el) => { statValues.push($(el).text().trim()); });

  const statMap: Record<string, string> = {};
  statNames.forEach((n, i) => {
    if (statValues[i]) statMap[n] = statValues[i];
  });

  // Invuln save
  const invuln = $(".dsCharInvulValue").first().text().trim() || undefined;

  // Weapons — ranged and melee sections live in the same <table>, separated by header tbodies.
  // We iterate all tbodies: a header tbody (contains .wTable_WEAPON) updates currentWeaponType,
  // then each .bkg tbody is one weapon parsed with that type.
  const weapons: WeaponProfile[] = [];
  $("table").each((_, table) => {
    if ($(table).find(".wTable_WEAPON").length === 0) return;

    let currentWeaponType: "ranged" | "melee" = "ranged";

    $(table).find("tbody").each((_, tbody) => {
      const hasSectionHeader = $(tbody).find(".wTable_WEAPON").length > 0;

      // Pure header tbody (no bkg class) — just update the active type and skip
      if (hasSectionHeader && !$(tbody).hasClass("bkg")) {
        const headerText = $(tbody).find(".wTable_WEAPON .dsHeader").first().text().trim().toUpperCase();
        currentWeaponType = headerText.includes("MELEE") ? "melee" : "ranged";
        return;
      }
      if (!$(tbody).hasClass("bkg")) return;

      // Weapon tbody — parse with the current type first, then check if it
      // also embeds a section header (which applies to the NEXT tbodies)
      const weaponType = currentWeaponType;
      if (hasSectionHeader) {
        const headerText = $(tbody).find(".wTable_WEAPON .dsHeader").first().text().trim().toUpperCase();
        currentWeaponType = headerText.includes("MELEE") ? "melee" : "ranged";
      }
      const shortRow = $(tbody).find("tr:not(.wTable2_long)").first();
      const nameCell = shortRow.find(".wTable2_short, td:nth-child(2)").first();

      // Collect weapon special rules from .kwb2 spans BEFORE stripping them
      // Each .kwb2 may contain multiple .tt word spans (e.g. "devastating" + "wounds")
      const weaponAbilities: string[] = [];
      nameCell.find(".kwb2").each((_, kwbEl) => {
        const words: string[] = [];
        $(kwbEl).find(".tt").each((_, tt) => {
          const w = $(tt).text().trim();
          if (w) words.push(w);
        });
        const keyword = words.length > 0 ? words.join(" ").toUpperCase() : $(kwbEl).text().trim().toUpperCase();
        if (keyword) weaponAbilities.push(keyword);
      });

      // Strip keyword spans to get clean weapon name
      nameCell.find(".kwb2").remove();
      const weaponName = nameCell.text().trim().replace(/\s+/g, " ");

      // Stat values from div.ct inside remaining tds (order: Range, A, BS/WS, S, AP, D)
      const ctDivs: string[] = [];
      shortRow.find("td").each((_, td) => {
        const ct = $(td).find(".ct, div").first();
        if (ct.length) {
          const val = ct.text().trim();
          if (val) ctDivs.push(val);
        }
      });

      const weapon: WeaponProfile = {
        name: weaponName || "Unknown",
        type: weaponType,
        range: ctDivs[0] || "-",
        attacks: ctDivs[1] || "-",
        bsWs: ctDivs[2] || "-",
        strength: ctDivs[3] || "-",
        ap: ctDivs[4] || "-",
        damage: ctDivs[5] || "-",
        abilities: weaponAbilities.join(", "),
      };

      if (weapon.name && weapon.name !== "Unknown") {
        weapons.push(weapon);
      }
    });
  });

  // Abilities — each .dsAbility div may contain multiple abilities separated by .dsLineHor dividers
  // Only collect from the ABILITIES section; stop when STRATAGEMS/ENHANCEMENTS header is hit
  const abilities: { name: string; description: string }[] = [];
  let pastAbilitiesSection = false;

  // Helper: parse a single ability text segment into { name, description }
  const parseAbilitySegment = (raw: string) => {
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text || text.length < 3) return;
    if (/^\d/.test(text)) return;
    if (/\d+\s*models/i.test(text)) return;
    if (/this unit can be led/i.test(text)) return;
    const colonIdx = text.indexOf(":");
    if (colonIdx > 0 && colonIdx < 80) {
      const abilityName = text.substring(0, colonIdx).trim();
      if (/\d/.test(abilityName)) return;
      const desc = text.substring(colonIdx + 1).trim();
      abilities.push({ name: abilityName, description: desc });
    } else if (text.length < 120) {
      abilities.push({ name: text, description: text });
    }
  };

  $(".dsAbility, .dsHeader").each((_, el) => {
    const cls = $(el).attr("class") || "";
    if (cls.includes("dsHeader") && !cls.includes("dsAbility")) {
      const headerText = $(el).text().trim().toUpperCase();
      if (
        headerText === "STRATAGEMS" ||
        headerText === "ENHANCEMENTS" ||
        headerText === "LEADER ABILITIES" ||
        headerText === "UNIT COMPOSITION"
      ) {
        pastAbilitiesSection = true;
      }
      return;
    }
    if (pastAbilitiesSection) return;

    // Split this ability div on .dsLineHor dividers — each segment is a separate ability
    const segments: string[] = [];
    let current = "";
    $(el).contents().each((_, node) => {
      const nodeEl = node as AnyNode;
      if (nodeEl.type === "tag" && $(nodeEl as Parameters<typeof $>[0]).hasClass("dsLineHor")) {
        segments.push(current);
        current = "";
      } else {
        current += $(nodeEl as Parameters<typeof $>[0]).text();
      }
    });
    segments.push(current);

    for (const seg of segments) {
      parseAbilitySegment(seg);
    }
  });

  // Unit keywords: parse comma-delimited text from .ds2colKW to preserve multi-word keywords
  const keywords: string[] = [];
  const kwBlock = $(".ds2colKW");
  if (kwBlock.length) {
    const rawKwText = kwBlock.text().replace(/\s+/g, " ").trim();
    const factionSplit = rawKwText.split(/FACTION\s+KEYWORDS\s*:/i);
    const unitSection = (factionSplit[0] || "").replace(/^KEYWORDS\s*:\s*/i, "").trim();
    const factionSection = (factionSplit[1] || "").trim();
    const parseSection = (text: string) =>
      text
        .split(",")
        .map((t) => t.trim().replace(/\s+/g, " ").toUpperCase())
        .filter((t) => t.length > 0 && t.length < 60 && !/KEYWORDS/i.test(t));
    keywords.push(...parseSection(unitSection), ...parseSection(factionSection));
  }

  // Wargear options — UL that follows the "WARGEAR OPTIONS" dsHeader
  const wargear_options: string[] = [];
  $(".dsHeader").each((_, el) => {
    if ($(el).text().trim().toUpperCase() !== "WARGEAR OPTIONS") return;
    // UL is the next sibling element
    const ul = $(el).next("ul");
    if (!ul.length) return;

    // Recursively flatten nested lists, preserving indent context
    const parseUl = (ulEl: ReturnType<typeof $>, depth: number) => {
      ulEl.children("li").each((_, li) => {
        const $li = $(li);
        const directText = $li.clone().children("ul, ol").remove().end().text().trim().replace(/\s+/g, " ");
        if (directText) {
          wargear_options.push(`${"  ".repeat(depth)}${depth > 0 ? "• " : ""}${directText}`);
        }
        $li.children("ul, ol").each((_, nested) => parseUl($(nested), depth + 1));
      });
    };
    parseUl(ul, 0);

    // Footnotes in .dsOptionsComment
    const footnote = $(el).nextAll(".dsOptionsComment").first().text().trim().replace(/\s+/g, " ");
    if (footnote) wargear_options.push(footnote);
  });

  // Points table: find the table containing .PriceTag cells and parse all rows
  // e.g. "5 models → 170", "10 models → 340"
  const points_table: PointsEntry[] = [];
  $("table").each((_, table) => {
    if ($(table).find(".PriceTag").length === 0) return;
    $(table).find("tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 2) return;
      const modelText = $(cells[0]).text().trim();
      const pointsText = $(cells[1]).find(".PriceTag").text().trim();
      const modelMatch = modelText.match(/(\d+)/);
      const pts = parseInt(pointsText, 10);
      if (modelMatch && !isNaN(pts) && pts > 0) {
        points_table.push({ models: parseInt(modelMatch[1], 10), points: pts });
      }
    });
  });

  // Derive points per model from the smallest increment in the table
  let points_per_model: number | undefined;
  if (points_table.length > 0) {
    // Sort by model count and use first entry (minimum unit size)
    const sorted = [...points_table].sort((a, b) => a.models - b.models);
    const min = sorted[0];
    points_per_model = Math.round(min.points / min.models);
  }

  return {
    name,
    faction,
    M: statMap["M"] || "-",
    T: statMap["T"] || "-",
    Sv: statMap["Sv"] || "-",
    W: statMap["W"] || "-",
    Ld: statMap["Ld"] || "-",
    OC: statMap["OC"] || "-",
    invuln,
    keywords,
    abilities,
    weapons,
    wargear_options,
    points_per_model,
    points_table,
  };
}

// ─── Faction / detachment / core stratagem scraping (11th edition) ───────────
// Faction pages and the core rules page render stratagems with the same `.str11Wrap`
// widget: `.str11Name` / `.str11CP` / `.str11Type` ("<Detachment> – <Type> Stratagem",
// or exactly "Core Stratagem") / `.str11Legend` (flavor) / `.str11Text` (WHEN/TARGET/
// EFFECT/RESTRICTIONS). Detachment headers look like:
//   [<div class="H2Unique">UNIQUE: <span>...</span>TAG</div>]
//   <h2 class="outline_header">Name<span class="dpPts"><img title="Force Disposition: X" ...>NDP</span></h2>

export interface Enhancement {
  name: string;
  points: number;
  description: string;
}

export interface DetachmentData {
  name: string;
  dpCost: number;
  uniqueTag: string | null;
  forceDisposition: string | null;
  ruleName: string;
  ruleText: string;
  enhancements: Enhancement[];
  stratagems: Stratagem[];
}

export interface FactionScrapeResult {
  detachments: DetachmentData[];
  factionStratagems: Stratagem[];
}

async function fetchWahapediaHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      Connection: "keep-alive",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function parseStratagemCards($: ReturnType<typeof cheerio.load>): Stratagem[] {
  const stratagems: Stratagem[] = [];

  $(".str11Wrap").each((_, el) => {
    const $el = $(el);
    const nameEl = $el.find(".str11Name").first().clone();
    nameEl.find(".h_number").remove();
    const name = nameEl.text().trim();
    if (!name) return;

    const type = $el.find(".str11Type").first().text().trim();
    if (!type) return; // not a stratagem card (e.g. move-type reference boxes reuse this widget)

    const cp = $el.find(".str11CP").first().text().trim();
    const legend = $el.find(".str11Legend").first().text().trim();

    const fullText = $el.find(".str11Text").first().text().replace(/\s+/g, " ").trim();
    const extract = (label: string) => {
      const rx = new RegExp(`${label}:\\s*(.+?)(?=(?:WHEN|TARGET|EFFECT|RESTRICTIONS):|$)`, "s");
      return fullText.match(rx)?.[1]?.trim() || "";
    };

    stratagems.push({
      name,
      cp: cp || "?CP",
      type,
      legend,
      when: extract("WHEN"),
      target: extract("TARGET"),
      effect: extract("EFFECT"),
      restrictions: extract("RESTRICTIONS") || undefined,
    });
  });

  return stratagems;
}

export async function scrapeWahapediaCoreStratagems(
  url = "https://wahapedia.ru/wh40k11ed/the-rules/core-rules/"
): Promise<Stratagem[]> {
  const html = await fetchWahapediaHtml(url);
  const $ = cheerio.load(html);
  return parseStratagemCards($).filter((s) => s.type.trim().toLowerCase() === "core stratagem");
}

export async function scrapeWahapediaFaction(url: string): Promise<FactionScrapeResult> {
  const html = await fetchWahapediaHtml(url);

  const headerRx =
    /(?:<div class="H2Unique">UNIQUE:\s*(?:<[^>]+>)*([^<]+?)(?:<\/[^>]+>)*<\/div>)?<h2 class="outline_header">(?:<img[^>]*>)?([^<]+)<span class="dpPts"><img title="Force Disposition:\s*([^"]*)"[^>]*>(\d+)DP<\/span><\/h2>/g;

  const headers: {
    index: number;
    length: number;
    name: string;
    dpCost: number;
    uniqueTag: string | null;
    forceDisposition: string | null;
  }[] = [];
  let match: RegExpExecArray | null;
  while ((match = headerRx.exec(html)) !== null) {
    headers.push({
      index: match.index,
      length: match[0].length,
      name: match[2].trim(),
      dpCost: parseInt(match[4], 10) || 1,
      uniqueTag: match[1] ? match[1].trim() : null,
      forceDisposition: match[3] ? match[3].trim() : null,
    });
  }

  const detachments: DetachmentData[] = [];
  const factionStratagems: Stratagem[] = [];

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const chunkStart = h.index + h.length;
    const chunkEnd = i + 1 < headers.length ? headers[i + 1].index : html.length;
    const $chunk = cheerio.load(html.slice(chunkStart, chunkEnd));

    // Detachment rule: first `.padHeader` heading in the chunk is the rule name;
    // its parent container holds the rule text alongside a `.ShowFluff` flavor paragraph.
    let ruleName = "";
    let ruleText = "";
    const ruleHeading = $chunk(".padHeader").first();
    if (ruleHeading.length) {
      ruleName = ruleHeading.text().trim();
      ruleText = ruleHeading
        .parent()
        .clone()
        .find(".padHeader, .ShowFluff")
        .remove()
        .end()
        .text()
        .replace(/\s+/g, " ")
        .trim();
    }

    // Enhancements: each is a `td.td_w` with a `.EnhancementsPts` name/points line,
    // a `.ShowFluff` flavor paragraph, then the restriction/effect text.
    const enhancements: Enhancement[] = [];
    $chunk("td.td_w").each((_, td) => {
      const $td = $chunk(td);
      const items = $td.find(".EnhancementsPts li").first();
      if (items.length === 0) return;
      const spans = items.find("span");
      const name = spans.eq(0).text().trim();
      const points = parseInt(spans.eq(1).text().trim(), 10) || 0;
      if (!name) return;
      const description = $td
        .clone()
        .find(".EnhancementsPts, .ShowFluff")
        .remove()
        .end()
        .text()
        .replace(/\s+/g, " ")
        .trim();
      enhancements.push({ name, points, description });
    });

    // Stratagems: `.str11Type` is either "<Detachment Name> – <Type> Stratagem" or,
    // for some narrower detachments, just "<Detachment Name> Stratagem". A chunk can
    // also trail into content for detachments this regex didn't recognize (e.g. Boarding
    // Actions variants without a DP badge) — cards owned by another known detachment are
    // dropped as boundary leakage rather than mislabeled as faction-wide.
    const detachmentStratagems: Stratagem[] = [];
    for (const s of parseStratagemCards($chunk)) {
      const owner = headers.find((dh) => s.type === dh.name || s.type.startsWith(`${dh.name} `));
      if (owner && owner.name === h.name) {
        const strippedType = s.type
          .slice(h.name.length)
          .replace(/^\s*–\s*/, "")
          .replace(/\s+Stratagem$/i, "")
          .trim();
        detachmentStratagems.push({ ...s, type: strippedType });
      } else if (!owner && s.type.toLowerCase() !== "core stratagem") {
        factionStratagems.push(s);
      }
    }

    detachments.push({
      name: h.name,
      dpCost: h.dpCost,
      uniqueTag: h.uniqueTag,
      forceDisposition: h.forceDisposition,
      ruleName,
      ruleText,
      enhancements,
      stratagems: detachmentStratagems,
    });
  }

  return { detachments, factionStratagems };
}
