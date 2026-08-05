/** Normalizes a faction name for loose matching, e.g. "T'au Empire" and "T Au Empire" both become "tauempire". */
export function normalizeFactionName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The scraper only understands 11th-edition Wahapedia markup. Older edition links
 * (wh40k10ed, wh40k9ed, ...) are a common paste mistake — rewrite them to wh40k11ed
 * rather than silently syncing zero detachments.
 */
export function normalizeWahapediaUrl(url: string): string {
  return url.replace(/\/wh40k\d+ed\//, "/wh40k11ed/");
}
