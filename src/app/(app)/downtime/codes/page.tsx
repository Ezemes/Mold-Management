import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { CATEGORY_HELP, DOWNTIME_CATEGORIES, downtimeCodes, type DowntimeCategory } from "@/lib/downtime";
import { Card, FlashFromParams, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CategoryBadge } from "@/components/downtime";
import { SubTabs } from "@/components/sub-tabs";
import { DOWNTIME_TABS } from "@/lib/tabs";
import { saveCodeAction } from "../actions";

export const metadata = { title: "Downtime reason codes" };

export default async function CodesPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["downtime", "view"]);
  const codes = await downtimeCodes(ctx.org.id, false);
  const used = await db.downtimeEvent.groupBy({ by: ["codeId"], where: { orgId: ctx.org.id }, _count: true });
  const canEdit = ctx.can("downtime", "approve") && !ctx.isSupplier;
  const count = (id: string) => used.find((u) => u.codeId === id)?._count ?? 0;
  return (
    <>
      <PageHeader title="Downtime" subtitle="The reasons people choose when they record downtime. The category decides how the time counts." />
      <SubTabs tabs={DOWNTIME_TABS} active="/downtime/codes" />
      <FlashFromParams params={sp} />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        {(Object.keys(DOWNTIME_CATEGORIES) as DowntimeCategory[]).map((c) => (
          <div key={c} className="rounded-lg border border-gray-200 p-3 text-sm"><CategoryBadge category={c} /><p className="mt-2 text-xs text-ink-500">{CATEGORY_HELP[c]}</p></div>
        ))}
      </div>
      {canEdit ? (
        <Card>
          <div className="divide-y divide-gray-100">
            {codes.map((c) => (
              <form key={c.id} action={saveCodeAction} className="flex flex-wrap items-center gap-2 py-2">
                <input type="hidden" name="id" value={c.id} />
                <Input name="code" defaultValue={c.code} aria-label={`Code ${c.code}`} className="w-28" required />
                <Input name="name" defaultValue={c.name} aria-label={`Name of ${c.code}`} className="min-w-64 flex-1" required />
                <Select name="category" defaultValue={c.category} options={DOWNTIME_CATEGORIES} aria-label={`Category of ${c.code}`} className="w-36" />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="active" defaultChecked={c.active} /> Active</label>
                <span className="w-20 text-xs text-ink-500">{count(c.id)} event(s)</span>
                <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
              </form>
            ))}
          </div>
        </Card>
      ) : (
        <Table head={["Code", "Name", "Category", "Active", "Events"]}>
          {codes.map((c) => (
            <tr key={c.id} className={c.active ? "" : "opacity-50"}>
              <Td className="font-medium">{c.code}</Td><Td>{c.name}</Td><Td><CategoryBadge category={c.category} /></Td><Td>{c.active ? "Yes" : "No"}</Td><Td>{count(c.id)}</Td>
            </tr>
          ))}
        </Table>
      )}
      {canEdit && (
        <Card title="Add a reason" className="mt-6 max-w-3xl">
          <form action={saveCodeAction} className="flex flex-wrap items-end gap-2">
            <Input name="code" placeholder="CODE" aria-label="New code" className="w-28" required />
            <Input name="name" placeholder="e.g. Broken guide pin" aria-label="New name" className="min-w-64 flex-1" required />
            <Select name="category" options={DOWNTIME_CATEGORIES} aria-label="New category" className="w-36" />
            <SubmitButton size="sm">Add</SubmitButton>
          </form>
        </Card>
      )}
    </>
  );
}
