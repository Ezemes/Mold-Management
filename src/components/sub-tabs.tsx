import Link from "next/link";
import { cx } from "./ui";

/** Section tabs under a page header; `active` is the href of the current tab. */
export function SubTabs({ tabs, active }: { tabs: [href: string, label: string][]; active: string }) {
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-gray-200">
      {tabs.map(([href, l]) => (
        <Link key={href} href={href} className={cx("-mb-px border-b-2 px-3 py-2 text-sm", active === href ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-ink-500 hover:text-ink-900")}>
          {l}
        </Link>
      ))}
    </div>
  );
}
