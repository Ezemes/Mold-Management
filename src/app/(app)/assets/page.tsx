import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assetScope, requireOrg, siteScope } from "@/lib/auth";
import { ASSET_STATUS } from "@/lib/assets";
import { liveStats, custodianName } from "@/lib/passport";
import { label } from "@/lib/labels";
import { fmtDate, fmtNum } from "@/lib/format";
import { assetFilter, type AssetFilterParams } from "@/lib/asset-filter";
import { LifeBar } from "@/components/life-bar";
import { Badge, btnClass, cx, EmptyState, FlashFromParams, LinkButton, PageHeader, Table, Td } from "@/components/ui";

export const metadata = { title: "Assets" };
const PAGE = 50;

type SP = AssetFilterParams & { overdue?: string; page?: string; error?: string; ok?: string };

export default async function AssetsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["assets", "view"]);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where: Prisma.AssetWhereInput = { AND: [assetScope(ctx), assetFilter(sp), { parentId: sp.q ? undefined : null }] };
  const include = { assetType: { include: { fields: true } }, site: true, custodianPartner: true, cavities: { select: { status: true } }, meters: true } as const;
  let rows = await db.asset.findMany({ where, include, orderBy: { number: "asc" }, ...(sp.overdue ? {} : { skip: (page - 1) * PAGE, take: PAGE }) });
  const live = new Map(rows.map((a) => [a.id, liveStats(a, ctx.org.readingOverdueDays, ctx.org)]));
  if (sp.overdue) rows = rows.filter((a) => live.get(a.id)!.readingOverdue);
  const total = sp.overdue ? rows.length : await db.asset.count({ where });
  if (sp.overdue) rows = rows.slice((page - 1) * PAGE, page * PAGE);
  const [types, sites, partners] = await Promise.all([
    db.assetType.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: "asc" } }),
    db.site.findMany({ where: siteScope(ctx), orderBy: { name: "asc" } }),
    ctx.isSupplier ? Promise.resolve([]) : db.partner.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: "asc" } }),
  ]);
  const qs = (patch: Partial<SP>) => `?${new URLSearchParams(Object.entries({ ...sp, error: undefined, ok: undefined, ...patch }).filter(([, v]) => v) as [string, string][])}`;
  const exportQs = new URLSearchParams(Object.entries({ q: sp.q, type: sp.type, site: sp.site, custodian: sp.custodian, status: sp.status }).filter(([, v]) => v) as [string, string][]);

  return (
    <>
      <PageHeader
        title={ctx.isSupplier ? "Molds in our custody" : "Assets"}
        subtitle={`${fmtNum(total, ctx.org)} ${sp.q ? "matching" : "top-level"} assets${ctx.scope.type !== "all" ? " in your scope" : ""}. Components are listed inside their parent.`}
        actions={
          <>
            {ctx.can("import_export") && <a className={btnClass("secondary")} href={`/import-export/assets.csv?${exportQs}`}>Export CSV</a>}
            {ctx.can("assets", "create") && <LinkButton href="/assets/new">New asset</LinkButton>}
          </>
        }
      />
      <FlashFromParams params={sp} />
      <form className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6" action="/assets">
        <input name="q" defaultValue={sp.q} placeholder="Number, name, tool, part no." className="input lg:col-span-2" />
        <select name="type" defaultValue={sp.type ?? ""} className="input"><option value="">All types</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <select name="site" defaultValue={sp.site ?? ""} className="input"><option value="">All sites</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        {!ctx.isSupplier && <select name="custodian" defaultValue={sp.custodian ?? ""} className="input"><option value="">Any custodian</option><option value="own">{ctx.org.name} (own)</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        <select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">Any status</option>{Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="overdue" value="1" defaultChecked={!!sp.overdue} /> Reading overdue</label>
        <button className={cx(btnClass("secondary"), "lg:col-start-6")}>Apply</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No assets match" body={ctx.can("assets", "create") ? "Create one, or import your fleet from a spreadsheet." : undefined} action={ctx.can("import_export", "create") ? <LinkButton href="/import-export" variant="secondary">Import from CSV</LinkButton> : undefined} />
      ) : (
        <Table head={["Asset", "Type", "Custodian · site", "Lifetime shots", "Life used", "Last reading", "Status"]}>
          {rows.map((a) => {
            const l = live.get(a.id)!;
            return (
              <tr key={a.id} className="hover:bg-gray-50">
                <Td><Link href={`/assets/${a.id}`} className="font-medium hover:text-brand-700">{a.number}</Link><p className="text-xs text-ink-700">{a.name}</p></Td>
                <Td className="text-xs">{a.assetType.name}</Td>
                <Td className="text-xs"><p className="font-medium">{custodianName(a, ctx.org.name)}</p><p className="text-ink-500">{a.site.name}{a.locationDetail && ` · ${a.locationDetail}`}</p></Td>
                <Td className="tabular-nums">{l.lifetimeShots != null ? fmtNum(l.lifetimeShots, ctx.org) : "—"}</Td>
                <Td>{l.endOfLifePct != null ? <LifeBar pct={l.endOfLifePct} /> : <span className="text-ink-500">—</span>}</Td>
                <Td className="text-xs">{l.features.meters ? <>{fmtDate(l.shots?.lastReadingAt, ctx.org.timezone)}{l.readingOverdue && <> <Badge status="overdue">overdue</Badge></>}</> : "—"}</Td>
                <Td><Badge status={a.status}>{label(ASSET_STATUS, a.status)}</Badge></Td>
              </tr>
            );
          })}
        </Table>
      )}
      <div className="mt-4 flex justify-between text-sm">
        {page > 1 ? <Link href={qs({ page: String(page - 1) })} className="text-brand-700">← Previous</Link> : <span />}
        {page * PAGE < total && <Link href={qs({ page: String(page + 1) })} className="text-brand-700">Next →</Link>}
      </div>
    </>
  );
}
