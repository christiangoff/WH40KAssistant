"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Side panel on the match page: match notes (autosaved to matches.notes),
// documents pinned to the match's army, and every other document the user can
// open — viewable inline (PDF / image / text) without leaving the tracker.
// Full-screen on mobile, a right-hand drawer on desktop that leaves the
// tracker usable beside it.

interface Doc {
  id: number;
  name: string;
  original_filename: string;
  mimetype: string;
  size: number;
}

type SaveState = "idle" | "saving" | "saved" | "error";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isInlineViewable(mimetype: string): boolean {
  return mimetype === "application/pdf" || mimetype.startsWith("image/") || mimetype.startsWith("text/");
}

function DocViewer({ doc, onBack }: { doc: Doc; onBack: () => void }) {
  const src = `/api/documents/${doc.id}/file`;
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-sm shrink-0">← Back</button>
        <div className="flex-1 min-w-0 text-white text-sm font-medium truncate">{doc.name}</div>
        <a href={src} target="_blank" rel="noopener noreferrer"
          className="text-xs text-amber-400 hover:text-amber-300 shrink-0">Open in new tab ↗</a>
      </div>
      <div className="flex-1 min-h-0 bg-gray-950">
        {doc.mimetype.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={doc.name} className="w-full h-full object-contain" />
        ) : isInlineViewable(doc.mimetype) ? (
          <iframe src={src} title={doc.name} className="w-full h-full bg-white" />
        ) : (
          <div className="p-6 text-sm text-gray-400">
            This file type can&apos;t be previewed here.{" "}
            <a href={src} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:text-amber-300">
              Open it in a new tab
            </a>{" "}
            instead.
          </div>
        )}
      </div>
    </div>
  );
}

export default function MatchDocsPanel({
  matchId,
  armyId,
  notes,
  onNotesSaved,
  onClose,
}: {
  matchId: number;
  armyId: number;
  notes: string | null;
  onNotesSaved: (notes: string) => void;
  onClose: () => void;
}) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [pinnedIds, setPinnedIds] = useState<number[]>([]);
  const [viewing, setViewing] = useState<Doc | null>(null);
  const [draft, setDraft] = useState(notes ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedRef = useRef(notes ?? "");
  const draftRef = useRef(draft);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Held in a ref so saveNotes stays stable — the unmount flush below must
  // only fire on close, not whenever the parent re-renders.
  const onNotesSavedRef = useRef(onNotesSaved);
  useEffect(() => { onNotesSavedRef.current = onNotesSaved; }, [onNotesSaved]);

  useEffect(() => {
    Promise.all([
      fetch("/api/documents").then(r => (r.ok ? r.json() : [])),
      fetch(`/api/armies/${armyId}/documents`).then(r => (r.ok ? r.json() : [])),
    ]).then(([all, pinned]: [Doc[], Doc[]]) => {
      setDocs(all);
      setPinnedIds(pinned.map(d => d.id));
    });
  }, [armyId]);

  const saveNotes = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const value = draftRef.current;
    if (value === savedRef.current) return;
    setSaveState("saving");
    const res = await fetch(`/api/matches/${matchId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: value }),
    }).catch(() => null);
    if (res?.ok) {
      savedRef.current = value;
      onNotesSavedRef.current(value);
      setSaveState(draftRef.current === value ? "saved" : "idle");
    } else {
      setSaveState("error");
    }
  }, [matchId]);

  function handleNotesChange(value: string) {
    setDraft(value);
    draftRef.current = value;
    setSaveState("idle");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(saveNotes, 800);
  }

  // Flush a pending notes save if the panel closes mid-debounce.
  useEffect(() => () => { void saveNotes(); }, [saveNotes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (viewing) setViewing(null); else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing, onClose]);

  async function togglePin(doc: Doc) {
    const pinned = pinnedIds.includes(doc.id);
    setPinnedIds(prev => (pinned ? prev.filter(id => id !== doc.id) : [...prev, doc.id]));
    const res = pinned
      ? await fetch(`/api/armies/${armyId}/documents?document_id=${doc.id}`, { method: "DELETE" })
      : await fetch(`/api/armies/${armyId}/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document_id: doc.id }),
        });
    if (!res.ok) setPinnedIds(prev => (pinned ? [...prev, doc.id] : prev.filter(id => id !== doc.id)));
  }

  const pinnedDocs = pinnedIds.map(id => docs?.find(d => d.id === id)).filter((d): d is Doc => !!d);
  const otherDocs = (docs ?? []).filter(d => !pinnedIds.includes(d.id));

  function renderDocRow(doc: Doc) {
    const pinned = pinnedIds.includes(doc.id);
    return (
      <li key={doc.id} className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg">
        <button onClick={() => setViewing(doc)} className="flex-1 min-w-0 text-left px-3 py-2 hover:bg-gray-800 rounded-l-lg">
          <div className="text-white text-sm truncate">{doc.name}</div>
          <div className="text-gray-500 text-xs truncate">{doc.original_filename} · {formatSize(doc.size)}</div>
        </button>
        <button
          onClick={() => togglePin(doc)}
          title={pinned ? "Unpin from this army" : "Pin to this army"}
          className={`shrink-0 text-xs px-2.5 py-1 mr-2 rounded border transition-colors ${
            pinned
              ? "bg-amber-900/40 border-amber-700 text-amber-300 hover:bg-amber-900/70"
              : "border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"
          }`}
        >
          {pinned ? "Pinned" : "Pin"}
        </button>
      </li>
    );
  }

  return (
    // z-[60]: above the mobile bottom nav (z-50) — full-screen there, with its own close button.
    <div className="fixed inset-y-0 right-0 z-[60] w-full md:w-[520px] lg:w-[44vw] bg-gray-950 border-l border-gray-800 shadow-2xl flex flex-col">
      {viewing ? (
        <DocViewer doc={viewing} onBack={() => setViewing(null)} />
      ) : (
        <>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
            <h2 className="text-white font-bold">Docs &amp; Notes</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none" aria-label="Close">×</button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* Notes */}
            <section>
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400">Match notes</h3>
                <span className={`text-xs ${saveState === "error" ? "text-red-400" : "text-gray-500"}`}>
                  {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Couldn't save" : ""}
                </span>
              </div>
              <textarea
                value={draft}
                onChange={e => handleNotesChange(e.target.value)}
                onBlur={() => void saveNotes()}
                rows={6}
                placeholder="Opponent's list, secondaries, reminders…"
                className="w-full bg-gray-900 border border-gray-800 focus:border-amber-700 rounded-lg p-3 text-sm text-gray-200 placeholder-gray-600 outline-none resize-y"
              />
            </section>

            {docs === null ? (
              <div className="text-gray-500 text-sm">Loading documents…</div>
            ) : docs.length === 0 ? (
              <div className="text-gray-500 text-sm">
                No documents yet. Upload rulebooks or reference sheets from your profile page.
              </div>
            ) : (
              <>
                <section>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-amber-400 mb-1.5">Pinned to this army</h3>
                  {pinnedDocs.length === 0 ? (
                    <div className="text-gray-500 text-xs">Pin a document below and it&apos;ll show here in every match with this army.</div>
                  ) : (
                    <ul className="space-y-1.5">{pinnedDocs.map(renderDocRow)}</ul>
                  )}
                </section>
                {otherDocs.length > 0 && (
                  <section>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-1.5">All documents</h3>
                    <ul className="space-y-1.5">{otherDocs.map(renderDocRow)}</ul>
                  </section>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
