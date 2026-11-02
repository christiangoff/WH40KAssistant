"use client";

import { useEffect, useState } from "react";
import { MATCH_RESULTS, MatchResult, RESULT_LABEL } from "@/lib/matchResult";

interface MatchResultDialogProps {
  title: string;
  confirmLabel: string;
  initial: MatchResult;
  busy?: boolean;
  onConfirm: (result: MatchResult) => void;
  onClose: () => void;
}

const SELECTED: Record<MatchResult, string> = {
  win: "bg-green-800 border-green-600 text-white",
  loss: "bg-red-800 border-red-600 text-white",
  draw: "bg-gray-600 border-gray-400 text-white",
};

export default function MatchResultDialog({ title, confirmLabel, initial, busy, onConfirm, onClose }: MatchResultDialogProps) {
  const [result, setResult] = useState<MatchResult>(initial);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-result-title"
        className="bg-gray-900 border border-gray-700 rounded-lg max-w-sm w-full p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="match-result-title" className="text-white font-bold mb-1">{title}</h2>
        <p className="text-gray-400 text-sm mb-3">How did the match go?</p>
        <div className="grid grid-cols-3 gap-2 mb-4" role="radiogroup" aria-label="Result">
          {MATCH_RESULTS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={result === r}
              onClick={() => setResult(r)}
              className={`py-2 rounded border font-medium text-sm transition-colors ${
                result === r ? SELECTED[r] : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {RESULT_LABEL[r]}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded text-sm text-gray-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(result)}
            disabled={busy}
            className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2 rounded font-medium text-sm transition-colors"
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
