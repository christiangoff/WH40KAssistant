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
  stratagems: Stratagem[];
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

  // Stratagems — each .s10Wrap references a tooltip content span with the full description
  const stratagems: Stratagem[] = [];
  // Build map of tooltip id → content span for fast lookup
  const tooltipMap: Record<string, ReturnType<typeof $>> = {};
  $("[id^='tooltip_content']").each((_, el) => {
    tooltipMap[$(el).attr("id") || ""] = $(el);
  });

  // Grab all stratagems on the page regardless of faction/detachment filter class.
  // Deduplicate by tooltip ID — the same stratagem can appear multiple times in the DOM
  // (once per detachment variant) but always points to the same tooltip content.
  const seenTooltips = new Set<string>();
  $(".s10Wrap").each((_, el) => {
    const $el = $(el);
    const nameEl = $el.find(".s10Name [data-tooltip-content]").first();
    const tooltipId = (nameEl.attr("data-tooltip-content") || "").replace("#", "");
    if (!tooltipId || !tooltipMap[tooltipId] || seenTooltips.has(tooltipId)) return;
    seenTooltips.add(tooltipId);

    const content = tooltipMap[tooltipId];
    const name = content.find(".str10Name").first().text().trim();
    const cp = content.find(".str10CP").first().text().trim();
    const type = content.find(".str10Type").first().text().trim().replace(/\s+Stratagem$/i, "");
    const legend = content.find(".str10Legend").first().text().trim().replace(/\s+/g, " ");

    const textEl = content.find(".str10Text").first();
    const fullText = textEl.text().replace(/\s+/g, " ").trim();
    const extract = (label: string) => {
      const rx = new RegExp(`${label}:\\s*(.+?)(?=(?:WHEN|TARGET|EFFECT|RESTRICTIONS):|$)`, "s");
      return fullText.match(rx)?.[1]?.trim() || "";
    };

    if (!name) return;
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
    stratagems,
    points_per_model,
    points_table,
  };
}
