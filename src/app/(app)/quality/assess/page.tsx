import Link from "next/link";
import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { templateForAsset, type ComponentResult } from "@/lib/inspection";
import { Card, Field, Input, Notice, PageHeader } from "@/components/ui";
import { AssessmentWizard } from "./wizard";

export const metadata = { title: "Condition assessment" };

/** Workflow-based inspection: choose bench or machine (and video), pick the asset, then go step by step. */
export default async function AssessPage({ searchParams }: { searchParams: Promise<{ asset?: string; mode?: string; video?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["quality", "create"]);
  const q = sp.asset?.trim() ?? "";
  const a = q
    ? await db.asset.findFirst({ where: { AND: [assetScope(ctx), { OR: [{ id: q }, { number: { equals: q, mode: "insensitive" } }] }] }, include: { assetType: true, meters: true, cavities: { select: { status: true } } } })
    : null;
  const mode = sp.mode === "machine" ? "machine" : "bench";
  const started = !!a && !!sp.mode;

  if (!started) {
    return (
      <>
        <PageHeader title="Start assessment" back={{ href: "/quality", label: "Quality" }} subtitle="A step-by-step condition assessment: each mold element is rated on the health scale, with key-point checks, comments and photos." />
        {q && !a && <Notice tone="error">No asset “{q}” in your scope.</Notice>}
        <Card className="max-w-xl">
          <form className="space-y-5">
            <fieldset>
              <legend className="label">Where is the assessment done?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-start gap-2 rounded-md border border-gray-200 p-3 text-sm"><input type="radio" name="mode" value="bench" defaultChecked={mode === "bench"} className="mt-1" /> <span><strong>On the bench</strong><span className="block text-xs text-ink-500">Mold out of the press; video can be recorded.</span></span></label>
                <label className="flex items-start gap-2 rounded-md border border-gray-200 p-3 text-sm"><input type="radio" name="mode" value="machine" defaultChecked={mode === "machine"} className="mt-1" /> <span><strong>On the machine</strong><span className="block text-xs text-ink-500">Mold in the press; no video.</span></span></label>
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="video" value="1" /> Record video in the background (bench only; stops at the last step)</label>
            <Field label="Asset ID or number" name="asset"><Input name="asset" required defaultValue={a?.number ?? q} placeholder="M-0001" /></Field>
            <button className="rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">Start assessment</button>
          </form>
        </Card>
      </>
    );
  }

  const template = await templateForAsset(ctx.org.id, a);
  const prev = await db.conditionEvaluation.findFirst({ where: { assetId: a.id, status: "approved" }, orderBy: { evaluatedAt: "desc" } });
  const previous = Object.fromEntries(((prev?.scores ?? []) as unknown as ComponentResult[]).map((c) => [c.key, c.score ?? null]));
  const meter = a.meters.find((m) => m.kind === "shots");
  return (
    <>
      <PageHeader title="Condition assessment" back={{ href: "/quality/assess", label: "Start again" }} subtitle={<>Template <strong>{template.name}</strong>{a.process ? ` for ${a.process}` : ""}. <Link href={`/assets/${a.id}`} className="text-brand-700 hover:underline">Open passport</Link></>} />
      <AssessmentWizard
        asset={{
          id: a.id, number: a.number, name: a.name, process: a.process, designCavities: a.designCavities,
          activeCavities: a.cavities.length ? a.cavities.filter((c) => c.status === "active").length : a.designCavities,
          lifetime: meter?.lifetimeTotal ?? null, lastRaw: meter?.lastRawValue ?? null, annualVolume: a.annualVolume, lastRunDate: a.lastRunDate ? a.lastRunDate.toISOString().slice(0, 10) : "",
        }}
        template={template}
        previous={previous}
        mode={mode}
        video={sp.video === "1" && mode === "bench"}
      />
    </>
  );
}
