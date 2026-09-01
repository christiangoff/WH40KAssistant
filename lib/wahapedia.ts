import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { MFMPricingTier } from "./mfm";
import { normalizeFactionName } from "./text";

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
  /**
   * Firing-profile name for multi-profile weapons (e.g. "Focused" / "Dispersed"
   * on the Stormsurge's pulse blast cannon). Every profile of one weapon shares
   * the same `name`, so weapon selection keys on `name` and picking the weapon
   * brings in all its profiles.
   */
  profile?: string;
}

/** Display label for a weapon row: "<name> – <profile>" when it has a profile. */
export function weaponLabel(w: Pick<WeaponProfile, "name" | "profile">): string {
  return w.profile ? `${w.name} – ${w.profile}` : w.name;
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
  /** Costed weapon/wargear upgrades from the MFM "WARGEAR OPTIONS" block (+N pts per copy equipped). */
  mfm_wargear?: { weapon: string; points: number }[];
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

  // Faction from URL path e.g. /factions/space-marines/
  let faction = "";
  const urlMatch = url.match(/\/factions\/([^/]+)\//);
  if (urlMatch) {
    faction = urlMatch[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Unit name. Wahapedia's <title> is "<A> — <B> [Warhammer 40,000 <edition>
  // edition]" where one of A/B is the faction and the other the unit name — 10th
  // edition puts the faction first ("Space Marines — Terminator Squad [...]"),
  // 11th edition puts the unit first ("Terminator Squad — Space Marines [...]").
  // So drop the [edition] suffix, split on the dash, and keep whichever segment
  // isn't the faction (which we already know from the URL). The <h1>, formatted
  // "<Faction> – <Unit>" in both editions, is the fallback. Raw title last.
  const rawTitle = $("title").text().trim();
  const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const factionKey = normName(faction);

  const pickUnitSegment = (text: string): string => {
    const segs = text
      .split(/\s+[—–]\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (segs.length < 2) return segs[0] ?? "";
    const nonFaction = factionKey ? segs.filter((s) => normName(s) !== factionKey) : segs;
    return (nonFaction.length ? nonFaction : segs).join(" – ");
  };

  const titleNoEdition = rawTitle.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
  // <h1> in older editions trails a "[ Chapter: … Detachment: … ]" filter blob and
  // newlines after the name — cut at the first bracket/newline before parsing.
  const h1Text = $("h1").first().text().split(/[[\n\r\t]/)[0].replace(/\s+/g, " ").trim();

  let name = pickUnitSegment(titleNoEdition);
  if (!name || (factionKey && normName(name) === factionKey)) {
    name = pickUnitSegment(h1Text) || name;
  }
  name = name || rawTitle || "Unknown Unit";

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
        const headerText = $(tbody).find(".wTable_WEAPON").first().text().trim().toUpperCase();
        currentWeaponType = headerText.includes("MELEE") ? "melee" : "ranged";
        return;
      }
      if (!$(tbody).hasClass("bkg")) return;

      // Weapon tbody — parse with the current type first, then check if it
      // also embeds a section header (which applies to the NEXT tbodies)
      const weaponType = currentWeaponType;
      if (hasSectionHeader) {
        const headerText = $(tbody).find(".wTable_WEAPON").first().text().trim().toUpperCase();
        currentWeaponType = headerText.includes("MELEE") ? "melee" : "ranged";
      }

      // Each stat row in the tbody is one firing profile. Single-profile weapons
      // ("Assault cannon") have one row; multi-profile weapons ("Pulse blast
      // cannon – focused" / "– dispersed") have one row per profile, each named
      // "<base> – <profile>". `.wTable2_long` rows are the wrapped-name copies and
      // rows carrying `.wTable_WEAPON` are the next section's header — skip both.
      const statRows = $(tbody)
        .find("tr:not(.wTable2_long)")
        .filter((_, tr) => $(tr).find(".wTable_WEAPON").length === 0)
        .toArray();
      const multiProfile = statRows.length > 1;

      for (const row of statRows) {
        const $row = $(row);
        const nameCell = $row.find(".wTable2_short, td:nth-child(2)").first();
        if (nameCell.length === 0) continue;

        // Weapon special rules live in .kwb2 (10th ed.) / .kwbw (11th ed.) spans,
        // each holding one or more .kwbu word spans (e.g. "devastating" + "wounds").
        // Collect them BEFORE stripping the spans to get a clean weapon name.
        const weaponAbilities: string[] = [];
        nameCell.find(".kwb2, .kwbw").each((_, kwbEl) => {
          const words: string[] = [];
          $(kwbEl).find(".kwbu").each((_, tt) => {
            const w = $(tt).text().trim();
            if (w) words.push(w);
          });
          const keyword = (words.length > 0 ? words.join(" ") : $(kwbEl).text().trim()).toUpperCase();
          if (keyword) weaponAbilities.push(keyword);
        });

        nameCell.find(".kwb2, .kwbw").remove();
        const rawName = nameCell.text().trim().replace(/\s+/g, " ");

        // Stat values from div.ct inside remaining tds (order: Range, A, BS/WS, S, AP, D)
        const ctDivs: string[] = [];
        $row.find("td").each((_, td) => {
          const ct = $(td).find(".ct, div").first();
          if (ct.length) {
            const val = ct.text().trim();
            if (val) ctDivs.push(val);
          }
        });

        let name = rawName;
        let profile: string | undefined;
        if (multiProfile) {
          const parts = rawName.split(/\s+[–—]\s+/);
          if (parts.length > 1) {
            name = parts[0].trim();
            const p = parts.slice(1).join(" – ").trim();
            if (p) profile = p.charAt(0).toUpperCase() + p.slice(1);
          }
        }

        const weapon: WeaponProfile = {
          name: name || "Unknown",
          type: weaponType,
          range: ctDivs[0] || "-",
          attacks: ctDivs[1] || "-",
          bsWs: ctDivs[2] || "-",
          strength: ctDivs[3] || "-",
          ap: ctDivs[4] || "-",
          damage: ctDivs[5] || "-",
          abilities: weaponAbilities.join(", "),
          ...(profile ? { profile } : {}),
        };

        if (weapon.name && weapon.name !== "Unknown") {
          weapons.push(weapon);
        }
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
  armyRuleName: string;
  armyRuleText: string;
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

// ─── Wahapedia CSV data export ────────────────────────────────────────────────
// wahapedia.ru/wh40k11ed/<Name>.csv — the official structured data export (pipe-
// delimited, one row per line). More reliable than scraping the rendered faction
// page for stratagem/enhancement text (the rendered page has been observed to
// silently serve incomplete content for some detachments), but it lags behind on
// brand-new content and doesn't carry the 11th-edition DP cost / unique tag
// fields, so it's used to enrich — not replace — the HTML-derived detachment list.

function htmlToPlainText(html: string): string {
  return cheerio.load(html).text().replace(/\s+/g, " ").trim();
}

function parseWahapediaCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split("|").map((h) => h.trim()).filter((h) => h.length > 0);

  return lines.slice(1).map((line) => {
    let fields = line.split("|");
    if (fields[fields.length - 1] === "") fields = fields.slice(0, -1);
    // A literal "|" inside a text field (rare) produces extra columns — fold the
    // overflow back into the last column rather than misaligning every field after it.
    if (fields.length > headers.length) {
      fields = [...fields.slice(0, headers.length - 1), fields.slice(headers.length - 1).join("|")];
    }
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (fields[i] ?? "").trim(); });
    return row;
  });
}

async function fetchWahapediaCsv(filename: string): Promise<Record<string, string>[]> {
  const response = await fetch(`https://wahapedia.ru/wh40k11ed/${filename}.csv`, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
  });
  if (!response.ok) throw new Error(`Failed to fetch ${filename}.csv: ${response.status}`);
  return parseWahapediaCsv(await response.text());
}

// Builds a Stratagem from a Stratagems.csv row. `type` is stored as
// "<Detachment or Core> – <Subtype> Stratagem" — everything after the first
// dash is the part we display; for rows with no dash the whole thing is kept.
function buildStratagemFromCsvRow(row: Record<string, string>): Stratagem {
  const plainDescription = htmlToPlainText(row.description ?? "");
  const extract = (label: string) => {
    const rx = new RegExp(`${label}:\\s*(.+?)(?=(?:WHEN|TARGET|EFFECT|RESTRICTIONS):|$)`, "s");
    return plainDescription.match(rx)?.[1]?.trim() || "";
  };
  const dashIdx = row.type.indexOf("–");
  const type = (dashIdx >= 0 ? row.type.slice(dashIdx + 1) : row.type).replace(/\s+Stratagem$/i, "").trim();

  return {
    name: row.name,
    cp: row.cp_cost ? `${row.cp_cost}CP` : "?CP",
    type,
    legend: htmlToPlainText(row.legend ?? ""),
    when: extract("WHEN"),
    target: extract("TARGET"),
    effect: extract("EFFECT"),
    restrictions: extract("RESTRICTIONS") || undefined,
  };
}

interface FactionCsvBundle {
  code: string;
  abilities: Record<string, string>[];
  enhancements: Record<string, string>[];
  stratagems: Record<string, string>[];
}

export interface WahapediaCsvExports {
  factions: Record<string, string>[];
  abilities: Record<string, string>[];
  enhancements: Record<string, string>[];
  stratagems: Record<string, string>[];
}

// The four faction-data CSVs, fetched together. Pass the result into
// scrapeWahapediaFaction() when syncing many factions to avoid re-downloading
// these (identical for every faction) each time.
export async function fetchAllFactionCsvs(): Promise<WahapediaCsvExports> {
  const [factions, abilities, enhancements, stratagems] = await Promise.all([
    fetchWahapediaCsv("Factions"),
    fetchWahapediaCsv("Detachment_abilities"),
    fetchWahapediaCsv("Enhancements"),
    fetchWahapediaCsv("Stratagems"),
  ]);
  return { factions, abilities, enhancements, stratagems };
}

// Looks up this faction's short Wahapedia code (e.g. "TAU") by fuzzy-matching
// its display name against Factions.csv, then returns just that faction's rows
// from the detachment-ability/enhancement/stratagem exports. Returns null if the
// export doesn't have a matching faction (e.g. a brand-new or misnamed faction) —
// callers should fall back to HTML-derived data in that case.
async function fetchFactionCsvBundle(
  factionName: string,
  prefetched?: WahapediaCsvExports
): Promise<FactionCsvBundle | null> {
  const { factions, abilities, enhancements, stratagems } = prefetched ?? (await fetchAllFactionCsvs());

  const target = normalizeFactionName(factionName);
  const faction = factions.find((f) => normalizeFactionName(f.name) === target);
  if (!faction) return null;

  const code = faction.id;
  return {
    code,
    abilities: abilities.filter((r) => r.faction_id === code),
    enhancements: enhancements.filter((r) => r.faction_id === code),
    stratagems: stratagems.filter((r) => r.faction_id === code),
  };
}

export interface CatalogUnit {
  /** Wahapedia datasheet id (stable key). */
  id: string;
  name: string;
  faction: string;
  wahapedia_url: string;
  legend: string;
}

// The full "every unit in the game" list, from Wahapedia's Datasheets.csv +
// Factions.csv exports. Used to let users pick a unit to add without hunting
// down its page URL themselves.
export async function fetchWahapediaCatalog(): Promise<CatalogUnit[]> {
  const [datasheets, factions] = await Promise.all([
    fetchWahapediaCsv("Datasheets"),
    fetchWahapediaCsv("Factions"),
  ]);

  const factionByCode = new Map(factions.map((f) => [f.id, f.name]));

  const units: CatalogUnit[] = [];
  const seen = new Set<string>();
  for (const row of datasheets) {
    if (!row.id || seen.has(row.id)) continue;
    if (row.virtual === "true") continue; // combined leader+bodyguard sheets — not real entries
    const url = (row.link || "").trim();
    if (!url.includes("/factions/")) continue;
    seen.add(row.id);
    units.push({
      id: row.id,
      name: (row.name || "").trim(),
      faction: factionByCode.get(row.faction_id) ?? row.faction_id ?? "Unknown",
      wahapedia_url: url,
      legend: (row.legend || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    });
  }
  return units;
}

export async function scrapeWahapediaCoreStratagems(
  url = "https://wahapedia.ru/wh40k11ed/the-rules/core-rules/"
): Promise<Stratagem[]> {
  try {
    const rows = await fetchWahapediaCsv("Stratagems");
    const core = rows.filter((r) => (r.type.split("–")[0] ?? "").trim().toLowerCase().startsWith("core"));

    // The export has duplicate/near-duplicate rows for the same core stratagem: verbatim
    // repeats, a generic "Core Stratagem" row alongside a properly-typed "Core – Battle
    // Tactic Stratagem" row for the same name, and punctuation-only name variants left over
    // from a mid-transition edit (e.g. "COUNTER-OFFENSIVE" vs "COUNTEROFFENSIVE"). Renamed
    // stratagems (old name still lingering in the export) are handled by dropping the old
    // name outright when the current name is also present.
    const RENAMED_TO_CURRENT: Record<string, string> = { GRENADE: "EXPLOSIVES" };
    const normalizeKey = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const currentNames = new Set(core.map((r) => normalizeKey(r.name)));
    const deduped = core.filter((r) => {
      const renamedTo = RENAMED_TO_CURRENT[r.name.toUpperCase()];
      return !(renamedTo && currentNames.has(normalizeKey(renamedTo)));
    });

    const byKey = new Map<string, Record<string, string>>();
    for (const r of deduped) {
      const key = normalizeKey(r.name);
      const existing = byKey.get(key);
      if (!existing || (!existing.type.includes("–") && r.type.includes("–"))) {
        byKey.set(key, r);
      }
    }
    if (byKey.size > 0) return [...byKey.values()].map(buildStratagemFromCsvRow);
  } catch {
    // fall through to HTML scrape below
  }

  const html = await fetchWahapediaHtml(url);
  const $ = cheerio.load(html);
  return parseStratagemCards($).filter((s) => s.type.trim().toLowerCase() === "core stratagem");
}

export async function scrapeWahapediaFaction(
  url: string,
  factionName: string,
  prefetchedCsvs?: WahapediaCsvExports
): Promise<FactionScrapeResult> {
  const [html, csv] = await Promise.all([
    fetchWahapediaHtml(url),
    fetchFactionCsvBundle(factionName, prefetchedCsvs).catch(() => null),
  ]);

  // Wahapedia's detachment `<h2>` tags carry an `id="<Name>"` attribute alongside
  // `class="outline_header"` (order not guaranteed) — matched generically rather than
  // assuming `class` is the only/first attribute, since that assumption has silently
  // broken this regex once already when Wahapedia added the id attribute.
  const headerRx =
    /(?:<div class="H2Unique">UNIQUE:\s*(?:<[^>]+>)*([^<]+?)(?:<\/[^>]+>)*<\/div>)?<h2[^>]*class="outline_header"[^>]*>(?:<img[^>]*>)?([^<]+)<span class="dpPts"><img title="Force Disposition:\s*([^"]*)"[^>]*>(\d+)DP<\/span><\/h2>/g;

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

  // Army Rule (e.g. T'au's "For the Greater Good") — a single faction-wide rule that
  // applies regardless of which detachment(s) are selected, rendered under an
  // `<h2 id="Army-Rules">` heading just before the first detachment on the page.
  let armyRuleName = "";
  let armyRuleText = "";
  const armyRulesIdx = html.indexOf('<h2 id="Army-Rules"');
  if (armyRulesIdx !== -1) {
    const armyRulesEnd = headers.length > 0 ? headers[0].index : armyRulesIdx + 4000;
    const $armyRules = cheerio.load(html.slice(armyRulesIdx, armyRulesEnd));
    const armyRuleHeading = $armyRules(".padHeader").first();
    if (armyRuleHeading.length) {
      armyRuleName = armyRuleHeading.text().trim();
      armyRuleText = armyRuleHeading
        .parent()
        .clone()
        .find(".padHeader, .ShowFluff, .faqErrataSpoiler")
        .remove()
        .end()
        .text()
        .replace(/\s+/g, " ")
        .trim();
    }
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
        .find(".padHeader, .ShowFluff, .faqErrataSpoiler")
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

    // Prefer the CSV data export where it has this detachment — it's been observed
    // to have more complete stratagem text than the rendered page for some
    // detachments. Fall back to what was scraped from the HTML above otherwise.
    if (csv) {
      const csvAbility = csv.abilities.find((r) => normalizeFactionName(r.detachment) === normalizeFactionName(h.name));
      if (csvAbility) {
        ruleName = csvAbility.name;
        ruleText = htmlToPlainText(csvAbility.description ?? "");
      }

      const csvEnhancements = csv.enhancements.filter((r) => normalizeFactionName(r.detachment) === normalizeFactionName(h.name));
      if (csvEnhancements.length > 0) {
        enhancements.length = 0;
        for (const r of csvEnhancements) {
          enhancements.push({ name: r.name, points: parseInt(r.cost, 10) || 0, description: htmlToPlainText(r.description ?? "") });
        }
      }

      const csvStratagems = csv.stratagems.filter((r) => normalizeFactionName(r.detachment) === normalizeFactionName(h.name));
      if (csvStratagems.length > 0) {
        detachmentStratagems.length = 0;
        detachmentStratagems.push(...csvStratagems.map(buildStratagemFromCsvRow));
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

  return { armyRuleName, armyRuleText, detachments, factionStratagems };
}
