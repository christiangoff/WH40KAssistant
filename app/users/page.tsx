"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface User {
  id: number;
  username: string;
  role: string;
  created_at: number;
}

const ROLE_STYLE: Record<string, string> = {
  admin: "bg-amber-900 text-amber-300",
  game_manager: "bg-blue-900 text-blue-300",
  user: "bg-gray-700 text-gray-400",
};

export default function PlayersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/users")
      .then(res => {
        if (!res.ok) { router.push("/login"); return null; }
        return res.json();
      })
      .then(data => {
        if (data) setUsers(data.filter((u: User & { archived: number }) => u.archived === 0));
        setLoading(false);
      });
  }, [router]);

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-amber-400 uppercase tracking-wide mb-6">Players</h1>

      <div className="space-y-2">
        {users.map(u => (
          <Link
            key={u.id}
            href={`/users/${u.username}`}
            className="flex items-center justify-between bg-gray-900 border border-gray-800 hover:border-amber-700 rounded-lg px-4 py-3 transition-colors group"
          >
            <span className="text-white font-medium group-hover:text-amber-400 transition-colors">
              {u.username}
            </span>
            <div className="flex items-center gap-3">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${ROLE_STYLE[u.role] ?? ROLE_STYLE.user}`}>
                {u.role}
              </span>
              <span className="text-gray-600 text-xs">
                {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
              </span>
              <span className="text-gray-600 group-hover:text-amber-400 text-sm transition-colors">→</span>
            </div>
          </Link>
        ))}
        {users.length === 0 && (
          <div className="text-gray-500 text-center py-12">No players yet.</div>
        )}
      </div>
    </div>
  );
}
