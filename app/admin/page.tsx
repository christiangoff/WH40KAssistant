"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface User {
  id: number;
  username: string;
  role: string;
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

export default function AdminPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ username: string; role: string } | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

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

  function fmt(ts: number) {
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  const unusedInvites = invites.filter(i => !i.used_by_name);
  const usedInvites = invites.filter(i => i.used_by_name);

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-amber-400 uppercase tracking-wide mb-6">Admin</h1>

      {/* Users */}
      <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
        <h2 className="text-white font-bold mb-3 uppercase text-sm tracking-wide">Users ({users.length})</h2>
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
              <div>
                <span className="text-white font-medium">{u.username}</span>
                {u.username === me?.username && (
                  <span className="ml-2 text-xs text-gray-500">(you)</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                  u.role === "admin" ? "bg-amber-900 text-amber-300" : "bg-gray-700 text-gray-400"
                }`}>
                  {u.role}
                </span>
                <span className="text-gray-500 text-xs">{fmt(u.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
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
                onClick={() => { navigator.clipboard?.writeText(newCode); }}
                className="text-xs text-green-400 hover:text-green-300 border border-green-700 px-2 py-1 rounded"
              >
                Copy
              </button>
            </div>
            <p className="text-gray-400 text-xs mt-1">
              Send this code to the new user. They can register at /register
            </p>
          </div>
        )}

        {unusedInvites.length > 0 && (
          <div className="mb-3">
            <p className="text-gray-500 text-xs uppercase font-bold mb-2">Active ({unusedInvites.length})</p>
            <div className="space-y-1">
              {unusedInvites.map((inv) => (
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
              {usedInvites.map((inv) => (
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
          <p className="text-gray-500 text-sm">No invite codes yet. Generate one to invite a new user.</p>
        )}
      </section>
    </div>
  );
}
