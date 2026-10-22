import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { criteriaFor, criteriaLines } from "@/lib/quality";
import { Card, cx, Field, FlashFromParams, Input, PageHeader, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { SubTabs } from "@/components/sub-tabs";
import { QUALITY_TABS } from "@/lib/tabs";
import { saveCriteriaAction } from "../actions";

export const metadata = { title: "Evaluation criteria" };

export default async function CriteriaPage({ searchParams }: { searchParams: Promise<{ type?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["quality", "view"]);
  const types = await db.assetType.findMany({ where: { orgId: ctx.org.id, archived: false }, orderBy: { createdAt: "asc" } });
  const t = types.find((x) => x.id === sp.type) ?? types[0];
  const canEdit = ctx.can("quality", "approve") && !ctx.isSupplier;
  return (
    <>
      <PageHeader title="Quality" subtitle="Each asset type has weighted criteria. A weighted score below the threshold raises a corrective work order when approved." />
      <SubTabs tabs={QUALITY_TABS} active="/quality/criteria" />
      <FlashFromParams params={sp} />
      <div className="mb-4 flex flex-wrap gap-1">
        {types.map((x) => <Link key={x.id} href={`/quality/criteria?type=${x.id}`} className={cx("rounded-md px-3 py-1.5 text-sm", x.id === t?.id ? "bg-brand-50 font-medium text-brand-700" : "text-ink-500 hover:bg-gray-100")}>{x.name}</Link>)}
      </div>
      {t && (
        <Card className="max-w-2xl" title={t.name}>
          <form action={saveCriteriaAction} className="space-y-4" key={t.id}>
            <input type="hidden" name="assetTypeId" value={t.id} />
            <Field label="Criteria" name="criteria" hint="One per line as “Label | weight”. A higher weight counts more in the score.">
              <Textarea name="criteria" rows={10} defaultValue={criteriaLines(criteriaFor(t))} className="font-mono text-xs" disabled={!canEdit} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Threshold (1–5)" name="threshold" hint="Approved scores below this raise a work order."><Input name="threshold" inputMode="decimal" defaultValue={t.evalThreshold} disabled={!canEdit} /></Field>
              <Field label="Evaluate every (days)" name="interval"><Input name="interval" inputMode="numeric" defaultValue={t.evalIntervalDays} disabled={!canEdit} /></Field>
            </div>
            {canEdit && <SubmitButton>Save criteria</SubmitButton>}
          </form>
        </Card>
      )}
    </>
  );
}
