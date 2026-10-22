import Link from "next/link";
import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { OPEN_WO, planState, TEMPLATE_KINDS } from "@/lib/maintenance";
import { label } from "@/lib/labels";
import { fmtDate, fmtNum } from "@/lib/format";
import { Badge, Card, cx, EmptyState, Field, FlashFromParams, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { MaintTabs } from "@/components/maint-tabs";
import { addPlanAction, runTriggersAction, togglePlanAction } from "../actions";

export const metadata = { title: "Maintenance plans" };

const STATE_COLOR = { ok: "green", due_soon: "amber", due: "red" } as const;
const STATE_LABEL = { ok: "On track", due_soon: "Due soon", due: "Due" } as const;

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ state?: string; asset?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["maintenance", "view"]);
  const canManage = ctx.can("maintenance", "create") && !ctx.isSupplier;
  const [plans, templates, types] = await Promise.all([
    db.maintenancePlan.findMany({
      where: { orgId: ctx.org.id, asset: { AND: [assetScope(ctx), { deletedAt: null }] } },
      include: { template: true, asset: { include: { meters: true } }, workOrders: { where: { status: { in: OPEN_WO } }, select: { id: true, number: true } } },
      orderBy: [{ asset: { number: "asc" } }],
      take: 1000,
    }),
    db.maintenanceTemplate.findMany({ where: { orgId: ctx.org.id, active: true }, orderBy: { name: "asc" } }),
    db.assetType.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: "asc" } }),
  ]);
  const now = new Date();
  const rows = plans.map((p) => ({ p, st: planState(p, p.asset.meters.find((m) => m.kind === "shots")?.lifetimeTotal ?? null, now) }));
  const filtered = rows.filter(({ p, st }) => (sp.state ? p.active && st.status === sp.state : true));
  const count = (s: string) => rows.filter(({ p, st }) => p.active && st.status === s).length;
  const ret = `/maintenance/plans${sp.state ? `?state=${sp.state}` : ""}`;

  return (
    <>
      <PageHeader
        title="Maintenance"
        subtitle="Each plan watches one asset's shot counter or the calendar, warns at the lead percentage and raises a work order when due."
        actions={canManage && (
          <form action={runTriggersAction}>
            <SubmitButton variant="secondary" pendingText="Checking…">Check triggers now</SubmitButton>
          </form>
        )}
      />
      <MaintTabs active="/maintenance/plans" />
      <FlashFromParams params={sp} />
      <div className="mb-4 flex flex-wrap gap-1">
        {[["", `All (${rows.length})`], ["due", `Due (${count("due")})`], ["due_soon", `Due soon (${count("due_soon")})`], ["ok", `On track (${count("ok")})`]].map(([k, l]) => (
          <Link key={k} href={`/maintenance/plans${k ? `?state=${k}` : ""}`} className={cx("rounded-md px-3 py-1.5 text-sm", (sp.state ?? "") === k ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>{l}</Link>
        ))}
      </div>

      {canManage && (
        <Card title="Add a plan" className="mb-6">
          {templates.length === 0 ? (
            <p className="text-sm text-ink-500">Create a <Link href="/maintenance/templates" className="text-brand-700 hover:underline">maintenance template</Link> first.</p>
          ) : (
            <form action={addPlanAction} className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <input type="hidden" name="return" value={ret} />
              <Field label="Asset number" name="asset" hint="Or pick an asset type to apply to all.">
                <Input name="asset" defaultValue={sp.asset ?? ""} placeholder="MLD-0001" />
              </Field>
              <Field label="…or every asset of type" name="assetTypeId">
                <Select name="assetTypeId" placeholder="—" options={types.map((t) => [t.id, t.name] as [string, string])} />
              </Field>
              <Field label="Template" name="templateId">
                <Select name="templateId" options={templates.map((t) => [t.id, `${t.name} (${label(TEMPLATE_KINDS, t.kind)})`] as [string, string])} />
              </Field>
              <Field label="Trigger" name="triggerType">
                <Select name="triggerType" options={{ shots: "Every N shots", days: "Every N days" }} />
              </Field>
              <Field label="Interval" name="interval">
                <Input name="interval" inputMode="numeric" required placeholder="e.g. 50,000" />
              </Field>
              <Field label="Warn at %" name="leadPct" hint="Early warning before due.">
                <Input name="leadPct" inputMode="numeric" defaultValue={90} />
              </Field>
              <Field label="Last done on" name="lastDone" hint="DD-MM-YYYY. Blank = today.">
                <Input name="lastDone" placeholder="DD-MM-YYYY" />
              </Field>
              <Field label="Last done at shots" name="lastShots" hint="Blank = current count.">
                <Input name="lastShots" inputMode="numeric" />
              </Field>
              <div className="sm:col-span-3 lg:col-span-4">
                <SubmitButton pendingText="Saving…">Set plan</SubmitButton>
              </div>
            </form>
          )}
        </Card>
      )}

      {filtered.length === 0 ? <EmptyState title="No plans here" body="Plans connect a template to an asset with a shot or calendar interval." /> : (
        <Table head={["Asset", "Plan", "Every", "Progress", "Next due", "Open work", "", ""]}>
          {filtered.map(({ p, st }) => (
            <tr key={p.id} className={cx(!p.active && "opacity-50")}>
              <Td><Link href={`/assets/${p.assetId}?tab=maintenance`} className="font-medium hover:text-brand-700">{p.asset.number}</Link><p className="text-xs text-ink-500">{p.asset.name}</p></Td>
              <Td>{p.template.name}<p className="text-xs text-ink-500">{label(TEMPLATE_KINDS, p.template.kind)}</p></Td>
              <Td className="text-xs">{fmtNum(p.interval, ctx.org)} {p.triggerType}<p className="text-ink-500">warn at {p.leadPct}%</p></Td>
              <Td className="w-40">
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                  <div className={cx("h-full", st.status === "due" ? "bg-red-500" : st.status === "due_soon" ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, st.progress * 100)}%` }} />
                </div>
                <p className="mt-1 text-xs text-ink-500">{Math.round(st.progress * 100)}% · {fmtNum(st.remaining, ctx.org)} {st.unit} left</p>
              </Td>
              <Td className="text-xs">{st.unit === "shots" ? `${fmtNum(st.dueAtShots, ctx.org)} shots` : fmtDate(st.dueDate, ctx.org.timezone)}</Td>
              <Td className="text-xs">{p.workOrders.map((w) => <Link key={w.id} href={`/maintenance/work-orders/${w.id}`} className="mr-1 text-brand-700 hover:underline">{w.number}</Link>)}</Td>
              <Td>{p.active ? <Badge color={STATE_COLOR[st.status]}>{STATE_LABEL[st.status]}</Badge> : <Badge status="inactive">Paused</Badge>}</Td>
              <Td>
                {canManage && (
                  <form action={togglePlanAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="return" value={ret} />
                    <SubmitButton size="sm" variant="ghost">{p.active ? "Pause" : "Resume"}</SubmitButton>
                  </form>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
