"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { UnitStats } from "@/lib/wahapedia";

interface CollectionUnit {
  name: string;
  faction: string | null;
  quantity: number;
  stats_json: string | null;
}

interface FactionGroup {
  faction: string;
  units: CollectionUnit[];
  totalModels: number;
  totalPoints: number;
}

interface Document {
  id: number;
  name: string;
  original_filename: string;
  mimetype: string;
  size: number;
  uploaded_by: number;
  uploader_name: string;
  shared_with_all: number;
  created_at: number;
}

interface ShareEntry {
  id: number;
  shared_with: number | null;
  shared_with_username: string | null;
}

interface Viewer {
  id: number;
  username: string;
  role: string;
}

interface ProfileUser {
  id: number;
  username: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeIcon(mime: string): string {
  if (mime === "application/pdf") return "📄";
  if (mime.startsWith("image/")) return "🖼";
  if (mime.startsWith("text/")) return "📝";
  if (mime.includes("word") || mime.includes("document")) return "📃";
  if (mime.includes("sheet") || mime.includes("excel")) return "📊";
  return "📎";
}

// ─── Documents panel ─────────────────────────────────────────────────────────

function DocumentsPanel({
  profileUser,
  viewer,
}: {
  profileUser: ProfileUser;
  viewer: Viewer;
}) {
  const isOwnProfile = viewer.id === profileUser.id;
  const isAdmin = viewer.role === "admin";

  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Share state (admin only)
  const [shareDocId, setShareDocId] = useState<number | null>(null);
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [allUsers, setAllUsers] = useState<{ id: number; username: string }[]>([]);
  const [sharingWith, setSharingWith] = useState<string>("");

  async function loadDocs() {
    const param = isOwnProfile ? "" : `?forUserId=${profileUser.id}`;
    const res = await fetch(`/api/documents${param}`);
    if (res.ok) setDocs(await res.json());
    setLoading(false);
  }

  useEffect(() => { loadDocs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", uploadFile);
    fd.append("name", uploadName || uploadFile.name);
    const res = await fetch("/api/documents", { method: "POST", body: fd });
    if (res.ok) {
      setUploadFile(null);
      setUploadName("");
      if (fileRef.current) fileRef.current.value = "";
      await loadDocs();
    }
    setUploading(false);
  }

  async function handleDelete(docId: number) {
    if (!confirm("Delete this document?")) return;
    await fetch(`/api/documents/${docId}`, { method: "DELETE" });
    setDocs(prev => prev.filter(d => d.id !== docId));
  }

  async function openSharePanel(docId: number) {
    setShareDocId(docId);
    const [sharesRes, usersRes] = await Promise.all([
      fetch(`/api/documents/${docId}/share`),
      fetch("/api/users"),
    ]);
    if (sharesRes.ok) setShares(await sharesRes.json());
    if (usersRes.ok) setAllUsers(await usersRes.json());
  }

  async function addShare(docId: number, sharedWith: number | null) {
    const res = await fetch(`/api/documents/${docId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shared_with: sharedWith }),
    });
    if (res.ok) {
      const entry: ShareEntry = await res.json();
      setShares(prev => [...prev, entry]);
    }
  }

  async function removeShare(docId: number, shareId: number) {
    await fetch(`/api/documents/${docId}/share`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ share_id: shareId }),
    });
    setShares(prev => prev.filter(s => s.id !== shareId));
  }

  const canUpload = isOwnProfile || isAdmin;

  const myDocs = docs.filter(d => d.uploaded_by === profileUser.id);
  const sharedDocs = docs.filter(d => d.uploaded_by !== profileUser.id);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-gray-800 flex items-center justify-between">
        <h2 className="text-amber-400 font-bold text-sm uppercase tracking-wide">Documents</h2>
        {canUpload && (
          <label className="cursor-pointer bg-red-700 hover:bg-red-600 text-white text-xs px-3 py-1 rounded transition-colors">
            + Upload
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0] ?? null;
                setUploadFile(f);
                if (f && !uploadName) setUploadName(f.name.replace(/\.[^.]+$/, ""));
              }}
            />
          </label>
        )}
      </div>

      {/* Upload form */}
      {uploadFile && (
        <form onSubmit={handleUpload} className="px-4 py-3 border-b border-gray-800 flex gap-2 items-center flex-wrap bg-gray-800/50">
          <input
            type="text"
            value={uploadName}
            onChange={e => setUploadName(e.target.value)}
            placeholder="Document name…"
            className="flex-1 min-w-0 bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-amber-500"
          />
          <span className="text-gray-500 text-xs shrink-0">{formatSize(uploadFile.size)}</span>
          <button
            type="submit"
            disabled={uploading}
            className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded"
          >
            {uploading ? "Uploading…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => { setUploadFile(null); setUploadName(""); if (fileRef.current) fileRef.current.value = ""; }}
            className="text-gray-500 hover:text-white text-xs"
          >
            Cancel
          </button>
        </form>
      )}

      {loading ? (
        <div className="px-4 py-6 text-gray-500 text-sm">Loading…</div>
      ) : docs.length === 0 ? (
        <div className="px-4 py-6 text-gray-500 text-sm text-center">No documents yet.</div>
      ) : (
        <div className="divide-y divide-gray-800">
          {/* Own uploads */}
          {myDocs.map(doc => (
            <DocRow
              key={doc.id}
              doc={doc}
              canDelete={isOwnProfile || isAdmin}
              canShare={isAdmin}
              onDelete={handleDelete}
              onShare={openSharePanel}
            />
          ))}

          {/* Shared with this user */}
          {sharedDocs.length > 0 && (
            <>
              <div className="px-4 py-1.5 bg-gray-800/40">
                <span className="text-gray-500 text-xs uppercase tracking-wide font-bold">Shared with {isOwnProfile ? "you" : profileUser.username}</span>
              </div>
              {sharedDocs.map(doc => (
                <DocRow
                  key={doc.id}
                  doc={doc}
                  canDelete={isAdmin}
                  canShare={isAdmin}
                  onDelete={handleDelete}
                  onShare={openSharePanel}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Share panel (admin) */}
      {shareDocId !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-md">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-white font-bold text-sm">Manage Sharing</h3>
              <button onClick={() => { setShareDocId(null); setShares([]); setSharingWith(""); }} className="text-gray-500 hover:text-white text-lg leading-none">×</button>
            </div>
            <div className="p-4 space-y-4">
              {/* Current shares */}
              <div>
                <p className="text-gray-400 text-xs uppercase font-bold mb-2">Shared with</p>
                {shares.length === 0 ? (
                  <p className="text-gray-600 text-sm">Not shared yet.</p>
                ) : (
                  <div className="space-y-1">
                    {shares.map(s => (
                      <div key={s.id} className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                        <span className="text-white text-sm">
                          {s.shared_with === null ? "Everyone" : s.shared_with_username}
                        </span>
                        <button
                          onClick={() => removeShare(shareDocId, s.id)}
                          className="text-gray-600 hover:text-red-400 text-xs"
                        >Remove</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add share */}
              <div>
                <p className="text-gray-400 text-xs uppercase font-bold mb-2">Add share</p>
                <div className="flex gap-2">
                  <select
                    value={sharingWith}
                    onChange={e => setSharingWith(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                  >
                    <option value="">— pick recipient —</option>
                    <option value="all">Everyone</option>
                    {allUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                  <button
                    disabled={!sharingWith}
                    onClick={() => {
                      addShare(shareDocId, sharingWith === "all" ? null : parseInt(sharingWith));
                      setSharingWith("");
                    }}
                    className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm px-3 py-2 rounded"
                  >
                    Share
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DocRow({
  doc,
  canDelete,
  canShare,
  onDelete,
  onShare,
}: {
  doc: Document;
  canDelete: boolean;
  canShare: boolean;
  onDelete: (id: number) => void;
  onShare: (id: number) => void;
}) {
  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <span className="text-xl shrink-0">{mimeIcon(doc.mimetype)}</span>
      <div className="flex-1 min-w-0">
        <a
          href={`/api/documents/${doc.id}/file`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-white text-sm font-medium hover:text-amber-400 transition-colors truncate block"
        >
          {doc.name}
        </a>
        <div className="text-gray-500 text-xs flex gap-3 mt-0.5 flex-wrap">
          <span>{formatSize(doc.size)}</span>
          <span>{doc.original_filename}</span>
          {doc.shared_with_all ? <span className="text-amber-600">Shared: everyone</span> : null}
          {doc.uploader_name && <span className="text-gray-600">by {doc.uploader_name}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {canShare && (
          <button
            onClick={() => onShare(doc.id)}
            className="text-gray-500 hover:text-amber-400 text-xs transition-colors"
          >
            Share
          </button>
        )}
        {canDelete && (
          <button
            onClick={() => onDelete(doc.id)}
            className="text-gray-600 hover:text-red-400 text-xs transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main profile page ────────────────────────────────────────────────────────

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const username = params.username as string;

  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [owner, setOwner] = useState<ProfileUser | null>(null);
  const [factionGroups, setFactionGroups] = useState<FactionGroup[]>([]);
  const [totals, setTotals] = useState({ units: 0, models: 0, points: 0 });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function load() {
      const [meRes, usersRes] = await Promise.all([
        fetch("/api/me"),
        fetch("/api/users"),
      ]);
      if (!meRes.ok) { router.push("/login"); return; }
      const me: Viewer = await meRes.json();
      setViewer(me);

      // /api/users is admin-only; fall back to finding user by collection endpoint
      let profileUserId: number | null = null;
      if (usersRes.ok) {
        const users: { id: number; username: string }[] = await usersRes.json();
        const found = users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (found) profileUserId = found.id;
      } else {
        // Non-admin: can only view own profile
        if (me.username.toLowerCase() === username.toLowerCase()) profileUserId = me.id;
      }

      if (profileUserId === null) { setNotFound(true); setLoading(false); return; }

      const res = await fetch(`/api/users/${profileUserId}/collection`);
      if (!res.ok) { setNotFound(true); setLoading(false); return; }

      const { owner: o, units }: { owner: ProfileUser; units: CollectionUnit[] } = await res.json();
      setOwner(o);

      const map = new Map<string, CollectionUnit[]>();
      for (const u of units) {
        const key = u.faction || "Unknown";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(u);
      }

      let totalModels = 0, totalPoints = 0;
      const groups: FactionGroup[] = Array.from(map.entries()).map(([faction, fUnits]) => {
        let gModels = 0, gPoints = 0;
        for (const u of fUnits) {
          gModels += u.quantity;
          if (u.stats_json) {
            const stats: UnitStats = JSON.parse(u.stats_json);
            gPoints += (stats.points_per_model ?? 0) * u.quantity;
          }
        }
        totalModels += gModels;
        totalPoints += gPoints;
        return { faction, units: fUnits, totalModels: gModels, totalPoints: gPoints };
      });

      setFactionGroups(groups);
      setTotals({ units: units.length, models: totalModels, points: totalPoints });
      setLoading(false);
    }
    load();
  }, [username, router]);

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;
  if (notFound) return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="text-gray-500 text-lg mb-2">User not found</div>
      <Link href="/users" className="text-amber-400 hover:underline text-sm">← Back to Players</Link>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/users" className="text-gray-500 hover:text-gray-300 text-sm mb-4 block">← Players</Link>

      <div className="flex items-end gap-4 mb-6">
        <h1 className="text-3xl font-bold text-amber-400">{owner?.username}</h1>
        <span className="text-gray-500 text-sm pb-1">Profile</span>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Unit Types", value: totals.units },
          { label: "Total Squads", value: totals.models },
          { label: "Est. Points", value: totals.points > 0 ? totals.points.toLocaleString() : "—" },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold font-mono text-white">{s.value}</div>
            <div className="text-gray-500 text-xs uppercase tracking-wide mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Documents */}
      {viewer && owner && (
        <div className="mb-6">
          <DocumentsPanel profileUser={owner} viewer={viewer} />
        </div>
      )}

      {/* Faction collection */}
      {factionGroups.length === 0 ? (
        <div className="text-gray-500 text-center py-12">No units in collection yet.</div>
      ) : (
        <div className="space-y-4">
          {factionGroups.map(({ faction, units, totalModels, totalPoints }) => (
            <div key={faction} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-gray-800 flex items-center justify-between">
                <h2 className="text-amber-400 font-bold text-sm uppercase tracking-wide">{faction}</h2>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span>{units.length} unit{units.length !== 1 ? "s" : ""}</span>
                  <span>{totalModels} squad{totalModels !== 1 ? "s" : ""}</span>
                  {totalPoints > 0 && <span>~{totalPoints} pts</span>}
                </div>
              </div>
              <div className="divide-y divide-gray-800">
                {units.map((u, i) => {
                  const stats: UnitStats | null = u.stats_json ? JSON.parse(u.stats_json) : null;
                  const pts = stats?.points_per_model ? stats.points_per_model * u.quantity : null;
                  return (
                    <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                      <div>
                        <span className="text-white text-sm">{u.name}</span>
                        {stats && (
                          <span className="ml-3 text-gray-600 text-xs font-mono">
                            M:{stats.M} T:{stats.T} W:{stats.W} Sv:{stats.Sv}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-right shrink-0">
                        {pts && <span className="text-gray-500 text-xs">{pts} pts</span>}
                        <span className="text-amber-400 font-bold font-mono text-sm w-8 text-right">{u.quantity}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
