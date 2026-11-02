export type MatchResult = "win" | "loss" | "draw";

export const MATCH_RESULTS: MatchResult[] = ["win", "loss", "draw"];

export const RESULT_LABEL: Record<MatchResult, string> = {
  win: "Win",
  loss: "Loss",
  draw: "Draw",
};

export const RESULT_BADGE: Record<MatchResult, string> = {
  win: "bg-green-900 text-green-300",
  loss: "bg-red-900 text-red-300",
  draw: "bg-gray-700 text-gray-300",
};

// The result the VP score points to, offered as the default when ending a match.
export function suggestResult(vp: number, vpOpponent: number): MatchResult {
  if (vp > vpOpponent) return "win";
  if (vp < vpOpponent) return "loss";
  return "draw";
}

export interface ArmyRecord {
  army_id: number;
  army_name: string;
  wins: number;
  losses: number;
  draws: number;
}

// Win/loss/draw per army, counted only from ended matches that have a result.
// Armies with no such match are left out. Computed from the match list itself,
// so deleting a match takes it off the record.
export function armyRecords(
  matches: { army_id: number; army_name: string | null; ended_at: number | null; result: MatchResult | null }[]
): ArmyRecord[] {
  const byArmy = new Map<number, ArmyRecord>();
  for (const m of matches) {
    if (!m.ended_at || !m.result) continue;
    let rec = byArmy.get(m.army_id);
    if (!rec) {
      rec = { army_id: m.army_id, army_name: m.army_name ?? `Army #${m.army_id}`, wins: 0, losses: 0, draws: 0 };
      byArmy.set(m.army_id, rec);
    }
    if (m.result === "win") rec.wins++;
    else if (m.result === "loss") rec.losses++;
    else rec.draws++;
  }
  return [...byArmy.values()].sort((a, b) => a.army_name.localeCompare(b.army_name));
}
