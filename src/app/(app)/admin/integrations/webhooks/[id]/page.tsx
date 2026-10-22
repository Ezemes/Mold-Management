import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { EVENT_TYPES } from "@/lib/webhooks.pure";
import { fmtDateTime } from "@/lib/format";
import { Badge, Card, Field, FlashFromParams, Input, Notice, PageHeader, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { SecretForm } from "@/components/secret-form";
import { deleteWebhookAction, pingWebhookAction, redeliverAction, rotateWebhookSecretAction, updateWebhookAction } from "../../actions";

export const metadata = { title: "Webhook endpoint" };

const STATUS = { delivered: "green", pending: "amber", failed: "red" } as const;

export default async function WebhookPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(["integrations", "view"]);
  const ep = await db.webhookEndpoint.findFirst({ where: { id, orgId: ctx.org.id } });
  if (!ep) notFound();
  const deliveries = await db.webhookDelivery.findMany({ where: { endpointId: ep.id }, include: { event: true }, orderBy: { createdAt: "desc" }, take: 50 });
  const canEdit = ctx.can("integrations", "edit");
  const hid = <input type="hidden" name="id" value={ep.id} />;
  return (
    <>
      <PageHeader back={{ href: "/admin/integrations?tab=webhooks", label: "Webhooks" }} title={<span className="break-all">{ep.url}</span>} subtitle={ep.description || undefined} actions={ep.active ? <Badge color="green">Active</Badge> : <Badge color="red">Disabled</Badge>} />
      <FlashFromParams params={sp} />
      {!ep.active && ep.disabledReason && <Notice tone="warn">{ep.disabledReason}</Notice>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Table head={["Event", "Created", "Attempts", "Result", ""]} empty="No deliveries yet.">
            {deliveries.map((d) => (
              <tr key={d.id}>
                <Td><code className="text-xs">{d.event.type}</code><p className="font-mono text-[11px] text-ink-500">{d.event.id}</p></Td>
                <Td className="text-xs">{fmtDateTime(d.createdAt, ctx.org.timezone)}</Td>
                <Td className="text-xs">{d.attempts}{d.status === "pending" && d.attempts > 0 && <p className="text-ink-500">next {fmtDateTime(d.nextAttemptAt, ctx.org.timezone)}</p>}</Td>
                <Td><Badge color={STATUS[d.status as keyof typeof STATUS]}>{d.status}{d.lastStatusCode ? ` · ${d.lastStatusCode}` : ""}</Badge>{d.lastError && <p className="mt-1 max-w-xs break-words text-xs text-red-700">{d.lastError}</p>}</Td>
                <Td>{canEdit && d.status !== "delivered" && <form action={redeliverAction}><input type="hidden" name="deliveryId" value={d.id} /><SubmitButton size="sm" variant="ghost">Retry now</SubmitButton></form>}</Td>
              </tr>
            ))}
          </Table>
        </div>
        {canEdit && (
          <div className="space-y-6">
            <Card title="Settings">
              <form action={updateWebhookAction} className="space-y-3">
                {hid}
                <Field label="Description" name="description"><Input name="description" defaultValue={ep.description} /></Field>
                <fieldset className="space-y-1">
                  {Object.keys(EVENT_TYPES).map((k) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name="events" value={k} defaultChecked={ep.events.includes(k)} /> <code className="text-xs">{k}</code></label>)}
                </fieldset>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={ep.active} /> Active</label>
                <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
              </form>
            </Card>
            <Card title="Test">
              <form action={pingWebhookAction}>{hid}<SubmitButton size="sm" pendingText="Sending…">Send test event</SubmitButton></form>
            </Card>
            <Card title="Signing secret">
              <SecretForm action={rotateWebhookSecretAction} submit="Rotate secret" note="The old secret stops working now. Update the receiver.">{hid}<p className="mb-3 text-xs text-ink-500">Secrets are encrypted at rest and never shown again after creation.</p></SecretForm>
            </Card>
            <Card title="Delete">
              <form action={deleteWebhookAction}>{hid}<SubmitButton size="sm" variant="danger" confirm="Delete this endpoint and its delivery history?">Delete endpoint</SubmitButton></form>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
