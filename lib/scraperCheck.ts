import { fetchWahapediaCsv, scrapeWahapediaUnit } from "@/lib/wahapedia";
import { normalizeWahapediaUrl } from "@/lib/text";

// Scraper self-check: scrape datasheet pages the way a unit refresh does and
// compare the result with Wahapedia's 11th-edition CSV export, which is the
// ground truth for what each datasheet says. Catches the scraper drifting out
// of step with Wahapedia's page markup (missing points, stray weapons, wrong
// stat lines) before players notice it in their collections.

type Row = Record<string, string>;

export interface ScraperCheckData {
  /** datasheet ids by normalized page URL */
  idsByUrl: Map<string, string[]>;
  models: Map<string, Row[]>;
  wargear: Map<string, Row[]>;
  costs: Map<string, Row[]>;
}

const urlKey = (url: string) => normalizeWahapediaUrl(url.trim()).replace(/\/+$/, "").toLowerCase();

function groupByDatasheet(rows: Row[]): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.datasheet_id) continue;
    out.set(r.datasheet_id, [...(out.get(r.datasheet_id) ?? []), r]);
  }
  return out;
}

export async function loadScraperCheckData(): Promise<ScraperCheckData> {
  const [datasheets, models, wargear, costs] = await Promise.all([
    fetchWahapediaCsv("Datasheets"),
    fetchWahapediaCsv("Datasheets_models"),
    fetchWahapediaCsv("Datasheets_wargear"),
    fetchWahapediaCsv("Datasheets_models_cost"),
  ]);
  const idsByUrl = new Map<string, string[]>();
  for (const d of datasheets) {
    if (!d.id || !d.link) continue;
    const k = urlKey(d.link);
    idsByUrl.set(k, [...(idsByUrl.get(k) ?? []), d.id]);
  }
  return { idsByUrl, models: groupByDatasheet(models), wargear: groupByDatasheet(wargear), costs: groupByDatasheet(costs) };
}

// Compare loosely: the export and the page differ in quote marks and spacing.
const norm = (v: unknown) => String(v ?? "").replace(/["”″]/g, "").replace(/\s+/g, "").toLowerCase();
const STATS = ["M", "T", "Sv", "W", "Ld", "OC"] as const;
const statLine = (o: Partial<Record<(typeof STATS)[number], unknown>>) => STATS.map((k) => norm(o[k])).join("/");
const weaponLine = (a: unknown, s: unknown, ap: unknown, d: unknown) => [a, s, ap, d].map(norm).join("/");

export interface DatasheetCheck {
  name: string;
  url: string;
  problems: string[];
}

// Scrape one datasheet page and list every way it disagrees with the export.
// Points are checked on the raw scrape — MFM pricing is layered on afterwards
// and isn't part of what the scraper reads.
export async function checkDatasheet(data: ScraperCheckData, url: string): Promise<DatasheetCheck> {
  const ids = data.idsByUrl.get(urlKey(url)) ?? [];
  if (ids.length === 0) return { name: url, url, problems: ["not in Wahapedia's 11th-edition export"] };
  const rowsFor = (m: Map<string, Row[]>) => ids.flatMap((id) => m.get(id) ?? []);

  const live = await scrapeWahapediaUnit(normalizeWahapediaUrl(url));
  const problems: string[] = [];

  const csvStats = new Set(rowsFor(data.models).map((m) => statLine(m)));
  const liveStats = (live.model_profiles?.length ? live.model_profiles : [live]).map(statLine);
  for (const l of liveStats) {
    if (!csvStats.has(l)) problems.push(`Stat line ${l} doesn't match the export (${[...csvStats].join(", ") || "none"})`);
  }

  // Weapon profiles as A/S/AP/D, both directions (the export has a few blank
  // placeholder rows, e.g. on fortifications with no weapons).
  const csvWeapons = new Set(rowsFor(data.wargear).filter((w) => w.name && w.A).map((w) => weaponLine(w.A, w.S, w.AP, w.D)));
  const liveWeapons = new Map<string, string>();
  for (const w of live.weapons) {
    liveWeapons.set(weaponLine(w.attacks, w.strength, w.ap, w.damage), w.profile ? `${w.name} – ${w.profile}` : w.name);
  }
  const missing = [...csvWeapons].filter((t) => !liveWeapons.has(t));
  const extra = [...liveWeapons].filter(([t]) => !csvWeapons.has(t));
  if (missing.length) problems.push(`Weapon profiles not scraped: ${missing.join(", ")}`);
  if (extra.length) problems.push(`Scraped weapons not on the datasheet: ${extra.map(([t, n]) => `${n} (${t})`).join(", ")}`);

  const csvPoints = new Set(
    rowsFor(data.costs).filter((c) => c.cost).map((c) => `${parseInt(c.description)} models: ${c.cost.trim()}`)
  );
  const livePoints = (live.points_table ?? []).map((p) => `${p.models} models: ${p.points}`);
  if (livePoints.length === 0 && csvPoints.size > 0) problems.push("No points scraped");
  for (const p of livePoints) {
    if (!csvPoints.has(p)) problems.push(`Points "${p}" not in the export (${[...csvPoints].join(", ") || "none"})`);
  }

  return { name: live.name || url, url, problems };
}
