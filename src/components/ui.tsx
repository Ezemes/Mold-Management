import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const BTN = {
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  secondary: "border border-gray-300 bg-white text-ink-900 hover:bg-gray-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-ink-700 hover:bg-gray-100",
} as const;
export type BtnVariant = keyof typeof BTN;

export function btnClass(variant: BtnVariant = "primary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:opacity-50 disabled:cursor-not-allowed",
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
    BTN[variant],
  );
}

export function Button({ variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return <button {...p} className={cx(btnClass(variant, size), className)} />;
}

export function LinkButton({ variant = "primary", size = "md", className, ...p }: ComponentProps<typeof Link> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return <Link {...p} className={cx(btnClass(variant, size), className)} />;
}

export function Card({ className, children, title, actions }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx("rounded-lg border border-gray-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="mb-2 inline-block text-xs text-ink-500 hover:text-brand-700">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const BADGE: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  gray: "bg-gray-100 text-gray-700 ring-gray-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
};

const STATUS_COLOR: Record<string, keyof typeof BADGE> = {
  active: "green", applied: "green", accepted: "green", validated: "blue",
  in_transfer: "blue", pending: "blue", invited: "blue",
  in_maintenance: "amber", refurbishing: "amber", overdue: "amber", blocked: "amber",
  quarantined: "red", suspended: "red", failed: "red", revoked: "red", scrapped: "red",
  retired: "gray", inactive: "gray", archived: "gray",
};

export function Badge({ children, color, status }: { children?: ReactNode; color?: keyof typeof BADGE; status?: string }) {
  const c = color ?? (status ? STATUS_COLOR[status] ?? "gray" : "gray");
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", BADGE[c])}>{children ?? status?.replace(/_/g, " ")}</span>;
}

export function Field({ label, name, hint, className, children }: { label: string; name?: string; hint?: string; className?: string; children?: ReactNode }) {
  return (
    <label className={cx("block", className)} htmlFor={name}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  );
}

export function Input(p: ComponentProps<"input">) {
  return <input id={p.name} {...p} className={cx("input", p.className)} />;
}

export function Textarea(p: ComponentProps<"textarea">) {
  return <textarea id={p.name} rows={3} {...p} className={cx("input", p.className)} />;
}

export function Select({ options, placeholder, ...p }: ComponentProps<"select"> & { options: Record<string, string> | [string, string][]; placeholder?: string }) {
  const entries = Array.isArray(options) ? options : Object.entries(options);
  return (
    <select id={p.name} {...p} className={cx("input", p.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {entries.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink-900">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: string }) {
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-ink-500">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.length ? children : (
            <tr>
              <td colSpan={head.length} className="px-4 py-8 text-center text-ink-500">
                {empty ?? "Nothing here yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("px-4 py-2.5 align-top", className)}>{children}</td>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "success"; children: ReactNode }) {
  const c = {
    info: "border-sky-200 bg-sky-50 text-sky-800",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  }[tone];
  return <div className={cx("mb-4 rounded-md border px-4 py-3 text-sm", c)}>{children}</div>;
}

/** Renders ?error= / ?ok= query messages set by server-action redirects. */
export function FlashFromParams({ params }: { params: { error?: string; ok?: string } }) {
  return (
    <>
      {params.error && <Notice tone="error">{decodeURIComponent(params.error)}</Notice>}
      {params.ok && <Notice tone="success">{decodeURIComponent(params.ok)}</Notice>}
    </>
  );
}
