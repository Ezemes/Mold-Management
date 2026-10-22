import Link from "next/link";
import { cx } from "./ui";

const TABS = [
  ["/maintenance", "Work orders"],
  ["/maintenance/plans", "Plans & triggers"],
  ["/maintenance/templates", "Templates"],
  ["/maintenance/reports", "Compliance"],
] as const;

export function MaintTabs({ active, supplier }: { active: string; supplier?: boolean }) {
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-gray-200">
      {TABS.filter(([href]) => !supplier || href === "/maintenance").map(([href, l]) => (
        <Link key={href} href={href} className={cx("-mb-px border-b-2 px-3 py-2 text-sm", active === href ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-ink-500 hover:text-ink-900")}>
          {l}
        </Link>
      ))}
    </div>
  );
}
