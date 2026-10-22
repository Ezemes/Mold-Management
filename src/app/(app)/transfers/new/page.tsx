import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { needsApproval, TRANSFER_REASONS } from "@/lib/transfers";
import { Card, Field, FlashFromParams, Input, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { createAndSubmitTransferAction, createTransferAction } from "../actions";

export const metadata = { title: "New transfer" };

export default async function NewTransferPage({ searchParams }: { searchParams: Promise<{ assets?: string; asset?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["transfers", "create"]);
  const pre = sp.asset ? await db.asset.findFirst({ where: { AND: [assetScope(ctx), { id: sp.asset }] }, include: { site: true } }) : null;
  const sites = await db.site.findMany({ where: { orgId: ctx.org.id, active: true }, include: { partner: true }, orderBy: [{ partnerId: "asc" }, { name: "asc" }] });
  const policy = ctx.org.transferApproval;
  return (
    <>
      <PageHeader back={{ href: "/transfers", label: "Transfers" }} title="New transfer" subtitle="Request a move of one or more molds from one site to another." />
      <FlashFromParams params={sp} />
      <Notice tone="info">
        {policy === "never" ? "Transfers in this organisation do not need approval." : policy === "always" ? "Every transfer needs approval before it can ship." : "Transfers that change the company holding a mold need approval."} The sender stays responsible until the receiver confirms receipt.
      </Notice>
      <Card>
        <form action={createTransferAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="Asset numbers" className="sm:col-span-2" hint="One or more, separated by commas or new lines. All must be at the same site.">
            <Textarea name="assets" rows={3} required defaultValue={pre?.number ?? sp.assets ?? ""} placeholder="M-0001, M-0002" />
          </Field>
          <Field label="Destination site">
            <Select name="toSiteId" options={sites.filter((s) => s.id !== pre?.siteId).map((s) => [s.id, s.partner ? `${s.name} (${s.partner.name})` : `${s.name} (${ctx.org.name})`] as [string, string])} />
          </Field>
          <Field label="Location at destination (optional)"><Input name="toLocationDetail" placeholder="e.g. Bay 4" /></Field>
          <Field label="Reason"><Select name="reason" options={TRANSFER_REASONS} /></Field>
          <Field label="Needed by"><Input name="neededBy" type="date" /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" /></Field>
          <div className="flex gap-2 sm:col-span-2">
            <SubmitButton formAction={createAndSubmitTransferAction}>Create and submit</SubmitButton>
            <SubmitButton variant="secondary">Save as draft</SubmitButton>
          </div>
          {pre && needsApproval(policy, pre.site.partnerId, null) && <p className="text-xs text-ink-500 sm:col-span-2">{pre.number} is currently at {pre.site.name}.</p>}
        </form>
      </Card>
    </>
  );
}
