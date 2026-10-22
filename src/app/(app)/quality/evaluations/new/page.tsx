import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { criteriaFor, SCORE_LABELS } from "@/lib/quality";
import { Card, Field, FlashFromParams, Input, Notice, PageHeader, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { submitEvaluationAction } from "../../actions";

export const metadata = { title: "New condition evaluation" };

export default async function NewEvaluationPage({ searchParams }: { searchParams: Promise<{ asset?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["quality", "create"]);
  const q = sp.asset?.trim() ?? "";
  const a = q ? await db.asset.findFirst({ where: { AND: [assetScope(ctx), { OR: [{ id: q }, { number: { equals: q, mode: "insensitive" } }] }] }, include: { assetType: true } }) : null;
  const criteria = a ? criteriaFor(a.assetType) : [];
  return (
    <>
      <PageHeader title="New condition evaluation" back={{ href: "/quality", label: "Quality" }} subtitle="Score each criterion from 1 (unusable) to 5 (as new). Leave a criterion blank if it does not apply." />
      <FlashFromParams params={sp} />
      {!a ? (
        <Card className="max-w-md">
          {q && <Notice tone="error">No asset “{q}” in your scope.</Notice>}
          <form className="flex items-end gap-3">
            <Field label="Asset number" name="asset"><Input name="asset" required placeholder="M-0001" /></Field>
            <button className="rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">Continue</button>
          </form>
        </Card>
      ) : (
        <form action={submitEvaluationAction} className="max-w-3xl space-y-6">
          <input type="hidden" name="assetId" value={a.id} />
          <Card title={`${a.number} ${a.name}`} actions={<span className="text-xs text-ink-500">Threshold {a.assetType.evalThreshold} · weights in brackets</span>}>
            <div className="divide-y divide-gray-100">
              {criteria.map((c) => (
                <div key={c.key} className="grid gap-2 py-3 sm:grid-cols-[1fr_10rem_14rem] sm:items-center">
                  <p className="text-sm font-medium">{c.label} <span className="font-normal text-ink-500">({c.weight})</span></p>
                  <select name={`score.${c.key}`} aria-label={`Score for ${c.label}`} defaultValue="" className="rounded border border-gray-300 px-2 py-1.5 text-sm">
                    <option value="">N/A</option>
                    {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{SCORE_LABELS[n]}</option>)}
                  </select>
                  <input name={`note.${c.key}`} placeholder="Note (required for 1–2)" aria-label={`Note for ${c.label}`} className="rounded border border-gray-200 px-2 py-1.5 text-sm" />
                </div>
              ))}
            </div>
          </Card>
          <Card title="Notes and photos">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Overall notes" name="notes"><Textarea name="notes" /></Field>
              <Field label="Photos" name="photos" hint="Up to 10 images or PDFs."><input type="file" name="photos" multiple accept="image/*,application/pdf" className="block w-full text-sm" /></Field>
            </div>
          </Card>
          <SubmitButton pendingText="Submitting…">Submit for approval</SubmitButton>
        </form>
      )}
    </>
  );
}
