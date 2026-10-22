"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const SECTION_ROOTS = new Set(["/", "/admin", "/agency", "/settings"]);

export function NavLink({ href, children, badge }: { href: string; children: ReactNode; badge?: number }) {
  const path = usePathname();
  // Section roots (whose sub-pages have their own nav entries) only match exactly.
  const active = path === href || (!SECTION_ROOTS.has(href) && path.startsWith(href + "/"));
  return (
    <Link
      href={href}
      className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${active ? "bg-brand-50 font-medium text-brand-700" : "text-ink-700 hover:bg-gray-100"}`}
    >
      <span>{children}</span>
      {!!badge && <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">{badge}</span>}
    </Link>
  );
}
