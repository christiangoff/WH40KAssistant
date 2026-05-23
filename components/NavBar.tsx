"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navLinks = [
  { href: "/", label: "Dashboard" },
  { href: "/collection", label: "Collection" },
  { href: "/armies", label: "Armies" },
  { href: "/matches", label: "Matches" },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="bg-gray-900 border-b border-red-900 shadow-lg">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <span className="text-red-500 text-2xl font-bold tracking-wider">
              &#9812;
            </span>
            <span className="text-amber-400 font-bold text-lg tracking-widest uppercase">
              WH40K Assistant
            </span>
          </div>
          <div className="flex gap-1">
            {navLinks.map((link) => {
              const active =
                link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                    active
                      ? "bg-red-800 text-white"
                      : "text-gray-300 hover:bg-gray-800 hover:text-white"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
