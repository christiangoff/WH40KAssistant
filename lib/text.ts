/** Normalizes a faction name for loose matching, e.g. "T'au Empire" and "T Au Empire" both become "tauempire". */
export function normalizeFactionName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
