"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";

const navLinks = [
  { href: "/", label: "Dashboard" },
  { href: "/collection", label: "Collection" },
  { href: "/armies", label: "Armies" },
  { href: "/matches", label: "Matches" },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const isAuthPage = pathname === "/login" || pathname === "/register";

  useEffect(() => {
    if (isAuthPage) return;

    fetch("/api/auth/me")
      .then((res) => {
        if (res.status === 401) { router.push("/login"); return null; }
        return res.json();
      })
      .then((data) => { if (data) setUser(data); })
      .catch(() => {});
  }, [router, isAuthPage]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  if (isAuthPage) return null;

  return (
    <>
      {/* Top bar */}
      <nav className="bg-gray-900 border-b border-red-900 shadow-lg print:hidden">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-2">
              <span className="text-red-500 text-2xl font-bold tracking-wider">&#9812;</span>
              <span className="text-amber-400 font-bold tracking-widest uppercase hidden sm:inline">
                WH40K Assistant
              </span>
              <span className="text-amber-400 font-bold tracking-widest uppercase sm:hidden">
                WH40K
              </span>
            </div>

            <div className="flex items-center gap-1">
              {/* Desktop nav links */}
              <div className="hidden md:flex gap-1">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                      isActive(link.href)
                        ? "bg-red-800 text-white"
                        : "text-gray-300 hover:bg-gray-800 hover:text-white"
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>

              {/* User menu */}
              {user && (
                <div className="relative ml-2" ref={menuRef}>
                  <button
                    onClick={() => setMenuOpen((v) => !v)}
                    className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 rounded px-3 py-1.5 text-sm text-gray-300 transition-colors"
                  >
                    <span className="hidden sm:inline">{user.username}</span>
                    <span className="sm:hidden text-gray-400 text-lg">☰</span>
                    <span className="text-gray-500 text-xs hidden sm:inline">{menuOpen ? "▲" : "▼"}</span>
                  </button>
                  {menuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-44 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
                      <div className="px-3 py-2 border-b border-gray-800">
                        <p className="text-white text-sm font-medium">{user.username}</p>
                        <p className="text-gray-500 text-xs capitalize">{user.role}</p>
                      </div>
                      {user.role === "admin" && (
                        <Link
                          href="/admin"
                          onClick={() => setMenuOpen(false)}
                          className="block px-3 py-2 text-sm text-amber-400 hover:bg-gray-800 transition-colors"
                        >
                          Admin Panel
                        </Link>
                      )}
                      <button
                        onClick={handleLogout}
                        className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 transition-colors"
                      >
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-gray-900 border-t border-gray-800 flex print:hidden">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`flex-1 py-3 text-center text-xs font-medium transition-colors border-t-2 ${
              isActive(link.href)
                ? "text-amber-400 border-amber-500"
                : "text-gray-500 border-transparent"
            }`}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
