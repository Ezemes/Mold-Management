import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction, switchOrgAction } from "@/app/(auth)/actions";
import { Logo } from "./logo";
import { NavLink } from "./nav-link";

export type NavItem = { href: string; label: string; badge?: number };

export function Shell({
  nav,
  children,
  heading,
  topRight,
  footer,
}: {
  nav: { title?: string; items: NavItem[] }[];
  children: ReactNode;
  heading: ReactNode;
  topRight?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="no-print hidden w-60 shrink-0 flex-col border-r border-gray-200 bg-white md:flex">
        <div className="flex h-14 items-center border-b border-gray-100 px-4">
          <Logo />
        </div>
        <div className="border-b border-gray-100 px-4 py-3 text-sm">{heading}</div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {nav.map((g, i) => (
            <div key={i}>
              {g.title && <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">{g.title}</p>}
              <ul className="space-y-0.5">
                {g.items.map((it) => (
                  <li key={it.href}>
                    <NavLink href={it.href} badge={it.badge}>
                      {it.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        {footer && <div className="border-t border-gray-100 px-4 py-3 text-xs">{footer}</div>}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-14 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 md:px-6">
          <details className="md:hidden">
            <summary className="cursor-pointer text-sm font-medium">Menu</summary>
            <div className="absolute left-0 z-20 mt-2 w-64 rounded-md border border-gray-200 bg-white p-3 shadow-lg">
              {nav.flatMap((g) => g.items).map((it) => (
                <Link key={it.href} href={it.href} className="block rounded px-2 py-1.5 text-sm hover:bg-gray-100">
                  {it.label}
                </Link>
              ))}
            </div>
          </details>
          <div className="flex flex-1 items-center justify-end gap-3">{topRight}</div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}

export function UserMenu({ name, email, links }: { name: string; email: string; links: { href: string; label: string }[] }) {
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-gray-100">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
          {(name || email).slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden sm:inline">{name || email}</span>
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-56 rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg">
        <p className="truncate px-3 py-2 text-xs text-ink-500">{email}</p>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="block px-3 py-1.5 hover:bg-gray-50">
            {l.label}
          </Link>
        ))}
        <form action={logoutAction}>
          <button className="block w-full px-3 py-1.5 text-left text-red-700 hover:bg-gray-50">Sign out</button>
        </form>
      </div>
    </details>
  );
}

export function OrgSwitcher({ current, options }: { current: { id: string; name: string }; options: { id: string; name: string }[] }) {
  if (options.length <= 1) return <p className="truncate font-medium">{current.name}</p>;
  return (
    <form action={switchOrgAction} className="flex items-center gap-1">
      <select name="org_id" defaultValue={current.id} className="w-full truncate rounded border border-gray-200 bg-white px-1 py-1 text-sm font-medium">
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <button className="rounded border border-gray-200 px-1.5 py-1 text-xs hover:bg-gray-50" title="Switch organisation">
        Go
      </button>
    </form>
  );
}
