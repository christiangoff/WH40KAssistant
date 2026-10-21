"use client";

import { useEffect, useState } from "react";

interface Health {
  catalog: { count: number; synced_at: number | null };
  counts: { current: number; outdated: number; retired: number; unlinked: number };
  units: {
    id: number;
    name: string | null;
    faction: string | null;
    owner: string | null;
    status: "outdated" | "retired";
    wahapedia_url: string | null;
    stats_fetched_at: number | null;
  }[];
  sync_error: string | null;
}

interface Mismatch {
  name: string;
  url: string;
  source: "collection" | "sample";
  problems: string[];
}

// Reads an NDJSON response line by line.
async function readStream(res: Response, onMessage: (msg: Record<string, unknown> & { type: string }) => void) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onMessage(JSON.parse(line));
  }
}

const fmtDateTime = (ts: number) =>
  new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const BUTTON =
  "bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors";
const BUTTON_SECONDARY =
  "bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 border border-gray-700 px-3 py-1.5 rounded text-sm font-medium transition-colors";

// Admin panel for keeping every collection on Wahapedia's current
// 11th-edition datasheets: checks for revisions, updates the units that are
// behind, and verifies the scraper still reads pages the way the export says.
export default function DatasheetHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"outdated" | "all" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);
  const [showUnits, setShowUnits] = useState(false);

  const [scraperRunning, setScraperRunning] = useState(false);
  const [scraperProgress, setScraperProgress] = useState<{ done: number; total: number } | null>(null);
  const [mismatches, setMismatches] = useState<Mismatch[]>([]);
  const [scraperResult, setScraperResult] = useState<{ total: number; passed: number; failed: number } | null>(null);
  const [scraperError, setScraperError] = useState("");

  async function loadHealth(sync: boolean) {
    setChecking(true);
    setError("");
    await fetchHealth(sync);
  }

  async function fetchHealth(sync: boolean) {
    try {
      const res = await fetch(`/api/admin/datasheets${sync ? "?sync=1" : ""}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't load datasheet status");
        return;
      }
      setHealth(data);
      if (data.sync_error) setError(`Couldn't reach Wahapedia: ${data.sync_error}`);
    } catch {
      setError("Couldn't load datasheet status");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    fetchHealth(false);
  }, []);

  async function handleRefresh(scope: "outdated" | "all") {
    if (scope === "all" && !confirm("Re-fetch Wahapedia stats and MFM points for every linked unit across all users? This can take several minutes.")) return;
    setBusy(scope);
    setProgress(null);
    setRefreshResult(null);
    setError("");
    try {
      const res = await fetch("/api/admin/refresh-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (!res.ok || !res.body) {
        setError((await res.json().catch(() => ({}))).error ?? "Refresh failed");
        return;
      }
      await readStream(res, (msg) => {
        if (msg.type === "start" || msg.type === "progress") {
          setProgress({ done: (msg.done as number) ?? 0, total: msg.total as number });
        } else if (msg.type === "done") {
          const total = msg.total as number;
          const failed = msg.failed as number;
          setRefreshResult(
            `Updated ${msg.succeeded}/${total} unit${total !== 1 ? "s" : ""}` +
              ` (${msg.unique_pages} unique page${msg.unique_pages !== 1 ? "s" : ""} scraped)` +
              (failed > 0 ? ` — ${failed} failed` : "")
          );
        }
      });
      await loadHealth(false);
    } catch {
      setError("Refresh failed");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function handleScraperCheck() {
    setScraperRunning(true);
    setScraperProgress(null);
    setMismatches([]);
    setScraperResult(null);
    setScraperError("");
    try {
      const res = await fetch("/api/admin/scraper-check", { method: "POST" });
      if (!res.ok || !res.body) {
        setScraperError((await res.json().catch(() => ({}))).error ?? "Scraper check failed");
        return;
      }
      await readStream(res, (msg) => {
        if (msg.type === "start" || msg.type === "progress") {
          setScraperProgress({ done: (msg.done as number) ?? 0, total: msg.total as number });
        } else if (msg.type === "mismatch") {
          setMismatches((m) => [...m, msg as unknown as Mismatch]);
        } else if (msg.type === "done") {
          setScraperResult({ total: msg.total as number, passed: msg.passed as number, failed: (msg.failed as number) + (msg.errored as number) });
        } else if (msg.type === "error") {
          setScraperError(msg.error as string);
        }
      });
    } catch {
      setScraperError("Scraper check failed");
    } finally {
      setScraperRunning(false);
      setScraperProgress(null);
    }
  }

  const c = health?.counts;
  const outdated = c?.outdated ?? 0;

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 mt-6">
      <h2 className="text-white font-bold uppercase text-sm tracking-wide mb-1">Datasheet Health</h2>
      <p className="text-gray-500 text-xs mb-3">
        Keeps every collection on Wahapedia&apos;s current 11th-edition datasheets. The datasheet list re-syncs daily
        and a player&apos;s outdated units update when they open their collection — use this to push updates for
        everyone now, and to check the scraper still reads Wahapedia correctly.
      </p>

      {health && c && (
        <div className="mb-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
            {[
              { label: "Current", value: c.current, style: "text-green-400" },
              { label: "Outdated", value: c.outdated, style: c.outdated ? "text-amber-400" : "text-gray-400" },
              { label: "Retired", value: c.retired, style: c.retired ? "text-red-400" : "text-gray-400" },
              { label: "Not linked", value: c.unlinked, style: "text-gray-400" },
            ].map((s) => (
              <div key={s.label} className="bg-gray-950 border border-gray-800 rounded px-3 py-2">
                <div className={`text-lg font-bold ${s.style}`}>{s.value}</div>
                <div className="text-gray-500 text-xs">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="text-gray-500 text-xs">
            {health.catalog.count} datasheets in the 11th-edition list
            {health.catalog.synced_at ? ` · checked ${fmtDateTime(health.catalog.synced_at)}` : ""}
          </div>
          {health.units.length > 0 && (
            <div className="mt-2">
              <button onClick={() => setShowUnits((v) => !v)} className="text-amber-400 hover:text-amber-300 text-xs">
                {showUnits ? "▾" : "▸"} {health.units.length} unit{health.units.length !== 1 ? "s" : ""} need attention
              </button>
              {showUnits && (
                <ul className="mt-1 max-h-64 overflow-y-auto divide-y divide-gray-800 border border-gray-800 rounded">
                  {health.units.map((u) => (
                    <li key={u.id} className="px-3 py-1.5 text-xs flex items-center gap-2">
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded border ${
                          u.status === "retired"
                            ? "bg-red-950 text-red-300 border-red-800"
                            : "bg-amber-950 text-amber-300 border-amber-800"
                        }`}
                      >
                        {u.status === "retired" ? "Retired" : "Outdated"}
                      </span>
                      <span className="text-white truncate">{u.name ?? "Unnamed"}</span>
                      <span className="text-gray-500 truncate">
                        {u.faction ?? ""}
                        {u.owner ? ` · ${u.owner}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {c.retired > 0 && (
                <p className="text-gray-500 text-xs mt-1">
                  Retired units can&apos;t be updated automatically — their owners see a &ldquo;Replace…&rdquo; button in
                  their collection to pick the new datasheet.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button onClick={() => loadHealth(true)} disabled={checking || busy !== null} className={BUTTON}>
          {checking ? "↻ Checking…" : "↻ Check Wahapedia for updates"}
        </button>
        <button onClick={() => handleRefresh("outdated")} disabled={busy !== null || outdated === 0} className={BUTTON}>
          {busy === "outdated"
            ? progress
              ? `↻ Updating ${progress.done}/${progress.total}…`
              : "↻ Starting…"
            : `Update outdated units${outdated ? ` (${outdated})` : ""}`}
        </button>
        <button onClick={() => handleRefresh("all")} disabled={busy !== null} className={BUTTON_SECONDARY}>
          {busy === "all"
            ? progress
              ? `↻ Refreshing ${progress.done}/${progress.total}…`
              : "↻ Starting…"
            : "Re-fetch all linked units"}
        </button>
      </div>
      {refreshResult && <div className="mt-2 text-green-400 text-xs">{refreshResult}</div>}
      {error && <div className="mt-2 text-red-400 text-xs">{error}</div>}

      <div className="border-t border-gray-800 mt-4 pt-3">
        <h3 className="text-white font-semibold text-sm mb-1">Scraper check</h3>
        <p className="text-gray-500 text-xs mb-2">
          Scrapes every datasheet in use in a collection, plus a random one from each faction, and compares stats,
          weapon profiles and points with Wahapedia&apos;s official data export. A mismatch means Wahapedia changed its
          page layout and the scraper needs fixing. Takes a minute or two.
        </p>
        <button onClick={handleScraperCheck} disabled={scraperRunning} className={BUTTON_SECONDARY}>
          {scraperRunning
            ? scraperProgress
              ? `Checking ${scraperProgress.done}/${scraperProgress.total}…`
              : "Downloading Wahapedia data…"
            : "Run scraper check"}
        </button>
        {scraperResult && (
          <div className={`mt-2 text-xs ${scraperResult.failed ? "text-red-400" : "text-green-400"}`}>
            {scraperResult.failed
              ? `${scraperResult.failed} of ${scraperResult.total} datasheets don't match Wahapedia's data.`
              : `All ${scraperResult.total} datasheets match Wahapedia's data.`}
          </div>
        )}
        {scraperError && <div className="mt-2 text-red-400 text-xs">{scraperError}</div>}
        {mismatches.length > 0 && (
          <ul className="mt-2 space-y-2">
            {mismatches.map((m) => (
              <li key={m.url} className="bg-gray-950 border border-red-900 rounded px-3 py-2 text-xs">
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-white font-medium hover:underline">
                  {m.name}
                </a>
                <span className="text-gray-500"> · {m.source === "collection" ? "in a collection" : "random sample"}</span>
                <ul className="mt-1 list-disc list-inside text-red-300 space-y-0.5">
                  {m.problems.map((p, i) => (
                    <li key={i} className="break-words">{p}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
