// Client + server safe constants and pure helpers for the battle simulator's
// spatial board (lib/battleSimSpatial.ts) — zero imports, so the board's
// React component can use these directly without pulling in server-only
// code (the scraper, better-sqlite3) into the browser bundle.

export interface Point {
  x: number;
  y: number;
}

export const BOARD_WIDTH = 44; // inches, x-axis
export const BOARD_DEPTH = 30; // inches, y-axis
export const DEPLOY_DEPTH = 10; // inches of deployment zone from each y-edge
export const ENGAGEMENT_RANGE = 1; // inches — matches the core rules' Engagement Range
export const OBJECTIVE_RADIUS = 3; // inches — matches the core rules' objective-control radius
export const MAX_CHARGE_THREAT = 12; // inches — the furthest a charge could ever succeed (2D6 max)

// Board layouts for the same three mission templates as the zone engine
// (name/description/scoring-round cadence reused from lib/battleSim.ts's
// MISSIONS) — an original, simplified set, not a transcription of any
// official mission pack.
export const OBJECTIVE_LAYOUTS: Record<string, { position: Point; vp: number }[]> = {
  "scorched-earth": [
    { position: { x: 11, y: 15 }, vp: 5 },
    { position: { x: 22, y: 15 }, vp: 5 },
    { position: { x: 33, y: 15 }, vp: 5 },
  ],
  "vantage-points": [
    { position: { x: 11, y: 15 }, vp: 5 },
    { position: { x: 22, y: 15 }, vp: 10 },
    { position: { x: 33, y: 15 }, vp: 5 },
  ],
  encirclement: [
    { position: { x: 22, y: 5 }, vp: 3 },
    { position: { x: 11, y: 15 }, vp: 4 },
    { position: { x: 22, y: 15 }, vp: 4 },
    { position: { x: 33, y: 15 }, vp: 4 },
    { position: { x: 22, y: 25 }, vp: 3 },
  ],
};

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clampToBoard(p: Point): Point {
  return { x: Math.max(0, Math.min(BOARD_WIDTH, p.x)), y: Math.max(0, Math.min(BOARD_DEPTH, p.y)) };
}

export interface BaseSize {
  shape: "circle" | "oval";
  /** mm, along the board's x-axis when the model faces "up" the board. */
  widthMm: number;
  /** mm, along the board's y-axis. Equals widthMm for a circular base. */
  depthMm: number;
}

const DEFAULT_BASE: BaseSize = { shape: "circle", widthMm: 32, depthMm: 32 };
// No printed base — mostly large vehicles/monsters measured from the model
// itself. We don't have real footprint dimensions from the datasheet text,
// so this is a deliberately-approximate stand-in, not a real measurement.
const NO_BASE_FALLBACK: BaseSize = { shape: "circle", widthMm: 100, depthMm: 100 };

/**
 * Parses a datasheet's base-size text — "(⌀32mm)" (round), "(⌀170 x 109mm)"
 * (oval), or "(⌀Use model)" (no printed base) — into board-renderable
 * dimensions.
 */
export function parseBaseSize(base: string | undefined | null): BaseSize {
  const s = (base ?? "").trim();
  if (!s) return DEFAULT_BASE;
  if (/use model/i.test(s)) return NO_BASE_FALLBACK;
  const oval = s.match(/(\d+)\s*x\s*(\d+)\s*mm/i);
  if (oval) return { shape: "oval", widthMm: parseInt(oval[1], 10), depthMm: parseInt(oval[2], 10) };
  const round = s.match(/(\d+)\s*mm/i);
  if (round) return { shape: "circle", widthMm: parseInt(round[1], 10), depthMm: parseInt(round[1], 10) };
  return DEFAULT_BASE;
}

const MM_PER_INCH = 25.4;

export function mmToInches(mm: number): number {
  return mm / MM_PER_INCH;
}
