import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { pressScope } from "@/lib/compat";
import { ASSET_STATUS } from "@/lib/assets";
import { label } from "@/lib/labels";
import { fmtNum } from "@/lib/format";
import { Badge, EmptyState, FlashFromParams, LinkButton, PageHeader, Table, Td } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";
import { PRESS_TABS } from "@/lib/tabs";

export const metadata = { title: "Presses" };

export default async function PressesPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["assets", "view"]);
  const [presses, pressType] = await Promise.all([
    db.asset.findMany({ where: pressScope(ctx), include: { site: { include: { partner: true } }, _count: { select: { moldsFor: { where: { status: "approved" } } } } }, orderBy: { number: "asc" } }),
    db.assetType.findFirst({ where: { orgId: ctx.org.id, kind: "press", archived: false }, orderBy: { createdAt: "asc" } }),
  ]);
  const n = (v: number | null, unit: string) => (v == null ? "—" : `${fmtNum(v, ctx.org)} ${unit}`);
  const pair = (a: number | null, b: number | null) => (a == null || b == null ? "—" : `${fmtNum(a, ctx.org)} × ${fmtNum(b, ctx.org)}`);
  return (
    <>
      <PageHeader
        title="Presses"
        subtitle="Molding machines and what they can take. The compatibility finder checks every mold against these limits."
        actions={ctx.can("assets", "create") && !ctx.isSupplier && pressType && <LinkButton href={`/assets/new?type=${pressType.id}`}>New press</LinkButton>}
      />
      <SubTabs tabs={PRESS_TABS} active="/presses" />
      <FlashFromParams params={sp} />
      {presses.length === 0 ? (
        <EmptyState title="No presses yet" body="Add presses as assets of the press type, with tonnage, tie-bar spacing, platen size and mold-height range." />
      ) : (
        <Table head={["Press", "Site", "Tonnage", "Tie bars (H × V mm)", "Platen (mm)", "Mold height (mm)", "Shot capacity", "HR zones", "Approved molds", "Status"]}>
          {presses.map((p) => (
            <tr key={p.id} className="hover:bg-gray-50">
              <Td><Link href={`/assets/${p.id}?tab=presses`} className="font-medium hover:text-brand-700">{p.number}</Link><p className="text-xs text-ink-500">{p.name}</p></Td>
              <Td className="text-xs">{p.site.name}{p.site.partner && <p className="text-ink-500">{p.site.partner.name}</p>}</Td>
              <Td>{n(p.clampTonnageT, "t")}</Td>
              <Td className="text-xs">{pair(p.tieBarHMm, p.tieBarVMm)}</Td>
              <Td className="text-xs">{pair(p.platenWMm, p.platenHMm)}</Td>
              <Td className="text-xs">{p.minMoldHeightMm == null && p.maxMoldHeightMm == null ? "—" : `${p.minMoldHeightMm ?? "—"}–${p.maxMoldHeightMm ?? "—"}`}</Td>
              <Td className="text-xs">{n(p.shotCapacityG, "g")}</Td>
              <Td className="text-xs">{p.hotRunnerZones ?? "—"}</Td>
              <Td className="text-xs"><Link href={`/presses/finder?press=${encodeURIComponent(p.number)}`} className="text-brand-700 hover:underline">{p._count.moldsFor} · find molds</Link></Td>
              <Td><Badge status={p.status}>{label(ASSET_STATUS, p.status)}</Badge></Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
