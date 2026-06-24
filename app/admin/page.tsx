"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface User {
  id: number;
  username: string;
  email: string | null;
  role: string;
  archived: number;
  created_at: number;
}

interface Invite {
  id: number;
  code: string;
  created_by_name: string;
  used_by_name: string | null;
  used_at: number | null;
  created_at: number;
}

const ROLES = ["admin", "game_manager", "user"] as const;

const ROLE_STYLE: Record<string, string> = {
  admin: "bg-amber-900 text-amber-300 border-amber-700",
  game_manager: "bg-blue-900 text-blue-300 border-blue-700",
  user: "bg-gray-700 text-gray-400 border-gray-600",
};

function UserRow({ user, me, onUpdated, onDeleted }: {
  user: User;
  me: { id: number; username: string };
  onUpdated: (u: User) => void;
  onDeleted: (id: number) => void;
}) {
  const [settingPassword, setSettingPassword] = useState(false);
  const [tempPassword, setTempPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isMe = user.id === me.id;

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) onUpdated(await res.json());
    else setError((await res.json()).error ?? "Failed");
  }

  async function handleDelete() {
    if (!confirm(`Delete ${user.username}? This will remove all their data permanently.`)) return;
    setSaving(true);
    const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
    setSaving(false);
    if (res.ok) onDeleted(user.id);
    else setError((await res.json()).error ?? "Failed");
  }

  async function handleSetPassword() {
    if (!tempPassword.trim()) return;
    await patch({ password: tempPassword.trim() });
    setTempPassword("");
    setSettingPassword(false);
  }

  const isArchived = user.archived === 1;

  return (
    <div className={`bg-gray-800 rounded-lg overflow-hidden border ${isArchived ? "border-gray-700 opacity-60" : "border-gray-700"}`}>
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
        {/* Identity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-bold text-sm ${isArchived ? "text-gray-500 line-through" : "text-white"}`}>
              {user.username}
            </span>
            {isMe && <span className="text-gray-500 text-xs">(you)</span>}
            {isArchived && <span className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">archived</span>}
          </div>
          {user.email && <div className="text-gray-500 text-xs mt-0.5">{user.email}</div>}
          <div className="text-gray-600 text-xs mt-0.5">joined {fmt(user.created_at)}</div>
        </div>

        {/* Role selector */}
        <select
          value={user.role}
          disabled={isMe || saving}
          onChange={e => patch({ role: e.target.value })}
          className={`border rounded px-2 py-1 text-xs font-medium focus:outline-none focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed ${ROLE_STYLE[user.role] ?? ROLE_STYLE.user} bg-transparent`}
        >
          {ROLES.map(r => <option key={r} value={r} className="bg-gray-800 text-white">{r}</option>)}
        </select>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setSettingPassword(v => !v)}
            disabled={saving}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded transition-colors"
          >
            Set Password
          </button>

          {!isMe && (
            <button
              onClick={() => patch({ archived: !isArchived })}
              disabled={saving}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                isArchived
                  ? "bg-green-900 hover:bg-green-800 text-green-300"
                  : "bg-gray-700 hover:bg-gray-600 text-gray-300"
              }`}
            >
              {isArchived ? "Restore" : "Archive"}
            </button>
          )}

          {!isMe && (
            <button
              onClick={handleDelete}
              disabled={saving}
              className="text-xs bg-red-900 hover:bg-red-800 text-red-300 px-2 py-1 rounded transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Temp password input */}
      {settingPassword && (
        <div className="px-4 pb-3 border-t border-gray-700 pt-2 flex items-center gap-2">
          <input
            type="text"
            value={tempPassword}
            onChange={e => setTempPassword(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleSetPassword(); if (e.key === "Escape") setSettingPassword(false); }}
            placeholder="New password..."
            autoFocus
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-amber-500"
          />
          <button
            onClick={handleSetPassword}
            disabled={!tempPassword.trim() || saving}
            className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-3 py-1 rounded text-sm"
          >
            Set
          </button>
          <button
            onClick={() => { setSettingPassword(false); setTempPassword(""); }}
            className="text-gray-500 hover:text-gray-300 text-sm px-2"
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <div className="px-4 pb-2 text-red-400 text-xs">{error}</div>
      )}
    </div>
  );
}

function fmt(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function AdminPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ id: number; username: string; role: string } | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  async function load() {
    const [meRes, usersRes, invitesRes] = await Promise.all([
      fetch("/api/auth/me"),
      fetch("/api/users"),
      fetch("/api/invites"),
    ]);
    if (!meRes.ok) { router.push("/login"); return; }
    const meData = await meRes.json();
    if (meData.role !== "admin") { router.push("/"); return; }
    setMe(meData);
    setUsers(usersRes.ok ? await usersRes.json() : []);
    setInvites(invitesRes.ok ? await invitesRes.json() : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleCreateInvite() {
    setCreating(true);
    setNewCode(null);
    const res = await fetch("/api/invites", { method: "POST" });
    if (res.ok) {
      const invite: Invite = await res.json();
      setNewCode(invite.code);
      await load();
    }
    setCreating(false);
  }

  async function handleRevokeInvite(code: string) {
    await fetch("/api/invites", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    await load();
  }

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;
  if (!me) return null;

  const activeUsers   = users.filter(u => u.archived === 0);
  const archivedUsers = users.filter(u => u.archived === 1);
  const unusedInvites = invites.filter(i => !i.used_by_name);
  const usedInvites   = invites.filter(i => i.used_by_name);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-amber-400 uppercase tracking-wide mb-6">Admin</h1>

      {/* Users */}
      <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white font-bold uppercase text-sm tracking-wide">
            Users ({activeUsers.length})
          </h2>
          {archivedUsers.length > 0 && (
            <button
              onClick={() => setShowArchived(v => !v)}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showArchived ? "Hide" : "Show"} archived ({archivedUsers.length})
            </button>
          )}
        </div>

        <div className="space-y-2">
          {activeUsers.map(u => (
            <UserRow
              key={u.id}
              user={u}
              me={me}
              onUpdated={updated => setUsers(prev => prev.map(x => x.id === updated.id ? updated : x))}
              onDeleted={id => setUsers(prev => prev.filter(x => x.id !== id))}
            />
          ))}
        </div>

        {showArchived && archivedUsers.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-gray-600 text-xs uppercase font-bold">Archived</p>
            {archivedUsers.map(u => (
              <UserRow
                key={u.id}
                user={u}
                me={me}
                onUpdated={updated => setUsers(prev => prev.map(x => x.id === updated.id ? updated : x))}
                onDeleted={id => setUsers(prev => prev.filter(x => x.id !== id))}
              />
            ))}
          </div>
        )}
      </section>

      {/* Invite Codes */}
      <section className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white font-bold uppercase text-sm tracking-wide">Invite Codes</h2>
          <button
            onClick={handleCreateInvite}
            disabled={creating}
            className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors"
          >
            {creating ? "Generating…" : "+ New Invite"}
          </button>
        </div>

        {newCode && (
          <div className="mb-4 bg-green-950 border border-green-700 rounded p-3">
            <p className="text-green-400 text-xs mb-1 font-medium uppercase">New invite code — share this:</p>
            <div className="flex items-center gap-3">
              <span className="text-white font-mono text-2xl tracking-widest font-bold">{newCode}</span>
              <button
                onClick={() => navigator.clipboard?.writeText(newCode)}
                className="text-xs text-green-400 hover:text-green-300 border border-green-700 px-2 py-1 rounded"
              >
                Copy
              </button>
            </div>
            <p className="text-gray-400 text-xs mt-1">Send this to the new user — they register at /register</p>
          </div>
        )}

        {unusedInvites.length > 0 && (
          <div className="mb-3">
            <p className="text-gray-500 text-xs uppercase font-bold mb-2">Active ({unusedInvites.length})</p>
            <div className="space-y-1">
              {unusedInvites.map(inv => (
                <div key={inv.id} className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-white font-mono tracking-widest font-bold">{inv.code}</span>
                    <span className="text-gray-500 text-xs">created {fmt(inv.created_at)}</span>
                  </div>
                  <button
                    onClick={() => handleRevokeInvite(inv.code)}
                    className="text-gray-600 hover:text-red-400 text-xs transition-colors"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {usedInvites.length > 0 && (
          <div>
            <p className="text-gray-500 text-xs uppercase font-bold mb-2">Used ({usedInvites.length})</p>
            <div className="space-y-1">
              {usedInvites.map(inv => (
                <div key={inv.id} className="flex items-center justify-between bg-gray-800/50 rounded px-3 py-2 opacity-60">
                  <span className="text-gray-500 font-mono tracking-widest">{inv.code}</span>
                  <div className="text-right">
                    <span className="text-gray-400 text-xs">used by {inv.used_by_name}</span>
                    {inv.used_at && <span className="text-gray-600 text-xs ml-2">{fmt(inv.used_at)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {invites.length === 0 && (
          <p className="text-gray-500 text-sm">No invite codes yet.</p>
        )}
      </section>
    </div>
  );
}
