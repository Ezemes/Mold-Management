import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { btnClass, PageHeader, Table, Td } from "@/components/ui";

export const metadata = { title: "Audit log" };
const PAGE = 50;

function Change({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].slice(0, 12);
  if (!keys.length) return null;
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <ul className="space-y-0.5 text-xs">
      {keys.map((k) => (
        <li key={k}><span className="text-ink-500">{k}:</span> {k in b && <span className="text-red-700 line-through">{show(b[k]).slice(0, 60)}</span>} {k in a && <span className="text-emerald-700">{show(a[k]).slice(0, 60)}</span>}</li>
      ))}
    </ul>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string; type?: string; entity?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["audit", "view"]);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where = { orgId: ctx.org.id, ...(sp.type ? { entityType: sp.type } : {}), ...(sp.entity ? { entityId: sp.entity } : {}) };
  const [rows, total, types] = await Promise.all([
    db.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { user: true } }),
    db.auditEvent.count({ where }),
    db.auditEvent.groupBy({ by: ["entityType"], where: { orgId: ctx.org.id } }),
  ]);
  const qs = (p: number) => `?${new URLSearchParams({ ...(sp.type ? { type: sp.type } : {}), ...(sp.entity ? { entity: sp.entity } : {}), page: String(p) })}`;
  return (
    <>
      <PageHeader title="Audit log" subtitle={`${total.toLocaleString("en-IN")} events. Entries cannot be edited or deleted.`} actions={<a className={btnClass("secondary")} href={`/admin/audit/export${sp.type ? `?type=${sp.type}` : ""}`}>Export CSV</a>} />
      <form className="mb-4 flex gap-2" action="/admin/audit">
        <select name="type" defaultValue={sp.type ?? ""} className="input max-w-56"><option value="">All entity types</option>{types.map((t) => <option key={t.entityType} value={t.entityType}>{t.entityType}</option>)}</select>
        <button className="rounded-md border border-gray-300 bg-white px-3 text-sm">Filter</button>
      </form>
      <Table head={["When", "Who", "Action", "Entity", "Change"]} empty="No events.">
        {rows.map((r) => (
          <tr key={r.id}>
            <Td className="whitespace-nowrap text-xs text-ink-500">{fmtDateTime(r.createdAt, ctx.org.timezone)}</Td>
            <Td className="text-xs">{r.user?.email ?? "system"}</Td>
            <Td className="text-xs">{r.action.replace(/_/g, " ")}{r.reason && <p className="text-ink-500">Reason: {r.reason}</p>}</Td>
            <Td className="text-xs">{r.entityType}{r.entityLabel && <p className="font-medium">{r.entityLabel}</p>}</Td>
            <Td><Change before={r.before} after={r.after} /></Td>
          </tr>
        ))}
      </Table>
      <div className="mt-4 flex justify-between text-sm">
        {page > 1 ? <Link href={qs(page - 1)} className="text-brand-700">← Newer</Link> : <span />}
        {page * PAGE < total && <Link href={qs(page + 1)} className="text-brand-700">Older →</Link>}
      </div>
    </>
  );
}
