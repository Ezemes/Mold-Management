import type { DowntimeCode } from "@prisma/client";
import { CATEGORY_COLOR, DOWNTIME_CATEGORIES, type DowntimeCategory } from "@/lib/downtime.pure";
import { Badge } from "./ui";

/** Reason picker grouped by category. */
export function CodeSelect({ codes, name = "codeId", defaultValue, required = true }: { codes: DowntimeCode[]; name?: string; defaultValue?: string; required?: boolean }) {
  return (
    <select id={name} name={name} defaultValue={defaultValue ?? ""} required={required} className="input">
      <option value="">Choose a reason…</option>
      {(Object.keys(DOWNTIME_CATEGORIES) as DowntimeCategory[]).map((cat) => {
        const list = codes.filter((c) => c.category === cat);
        return list.length ? (
          <optgroup key={cat} label={DOWNTIME_CATEGORIES[cat]}>
            {list.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </optgroup>
        ) : null;
      })}
    </select>
  );
}

export function CategoryBadge({ category }: { category: string }) {
  return <Badge color={CATEGORY_COLOR[category as DowntimeCategory] ?? "gray"}>{DOWNTIME_CATEGORIES[category as DowntimeCategory] ?? category}</Badge>;
}
