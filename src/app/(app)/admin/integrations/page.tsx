import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { API_SCOPES } from "@/lib/api-scopes";
import { EVENT_TYPES } from "@/lib/webhooks.pure";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Badge, Card, Field, FlashFromParams, Input, PageHeader, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { SecretForm } from "@/components/secret-form";
import { SubTabs } from "@/components/sub-tabs";
import { createApiKeyAction, createWebhookAction, revokeApiKeyAction } from "./actions";
import { SsoTab } from "./sso-tab";

export const metadata = { title: "Integrations" };

const TABS: [string, string][] = [["/admin/integrations", "API keys"], ["/admin/integrations?tab=webhooks", "Webhooks"], ["/admin/integrations?tab=sso", "Single sign-on"]];

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["integrations", "view"]);
  const tab = sp.tab === "webhooks" || sp.tab === "sso" ? sp.tab : "keys";
  const canEdit = ctx.can("integrations", "edit");
  const sites = await db.site.findMany({ where: { orgId: ctx.org.id, active: true }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="Integrations" subtitle={<>Connect other systems to Plant Metrics. The API and webhook reference is at <Link href="/developers" className="text-brand-700 hover:underline">/developers</Link>.</>} />
      <SubTabs tabs={TABS} active={tab === "keys" ? "/admin/integrations" : `/admin/integrations?tab=${tab}`} />
      <FlashFromParams params={sp} />
      {tab === "keys" && <KeysTab orgId={ctx.org.id} tz={ctx.org.timezone} canEdit={canEdit} sites={sites} />}
      {tab === "webhooks" && <WebhooksTab orgId={ctx.org.id} tz={ctx.org.timezone} canEdit={canEdit} />}
      {tab === "sso" && <SsoTab ctx={ctx} />}
    </>
  );
}

async function KeysTab({ orgId, tz, canEdit, sites }: { orgId: string; tz: string; canEdit: boolean; sites: { id: string; name: string }[] }) {
  const keys = await db.apiKey.findMany({ where: { orgId }, orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }] });
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? "?";
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Table head={["Key", "Scopes", "Sites", "Last used", "Status", ""]} empty="No API keys yet.">
          {keys.map((k) => {
            const expired = k.expiresAt && k.expiresAt < new Date();
            return (
              <tr key={k.id}>
                <Td><p className="font-medium">{k.name}</p><p className="font-mono text-xs text-ink-500">pmk_{k.prefix}_…</p></Td>
                <Td className="text-xs">{k.scopes.join(", ")}</Td>
                <Td className="text-xs">{k.siteIds.length ? k.siteIds.map(siteName).join(", ") : "All"}</Td>
                <Td className="text-xs">{k.lastUsedAt ? fmtDateTime(k.lastUsedAt, tz) : "Never"}</Td>
                <Td>{k.revokedAt ? <Badge status="revoked">Revoked</Badge> : expired ? <Badge color="gray">Expired</Badge> : <Badge color="green">Active</Badge>}{k.expiresAt && !k.revokedAt && <p className="mt-1 text-xs text-ink-500">until {fmtDate(k.expiresAt, tz)}</p>}</Td>
                <Td>
                  {canEdit && !k.revokedAt && (
                    <form action={revokeApiKeyAction}>
                      <input type="hidden" name="id" value={k.id} />
                      <SubmitButton size="sm" variant="ghost" confirm={`Revoke “${k.name}”? Systems using it will stop working.`}>Revoke</SubmitButton>
                    </form>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      </div>
      {canEdit && (
        <Card title="New API key">
          <SecretForm action={createApiKeyAction} submit="Create key" note="This is the only time the full key is shown. Store it in the other system's secret store." className="space-y-4">
            <Field label="Name" name="name"><Input name="name" required placeholder="MES shot counter feed" /></Field>
            <fieldset>
              <legend className="label">Scopes</legend>
              <div className="space-y-1">
                {Object.entries(API_SCOPES).map(([k, v]) => (
                  <label key={k} className="flex items-start gap-2 text-sm"><input type="checkbox" name="scopes" value={k} className="mt-1" /> <span><code className="text-xs">{k}</code><span className="block text-xs text-ink-500">{v}</span></span></label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="label">Limit to sites (optional)</legend>
              <div className="grid grid-cols-2 gap-1">
                {sites.map((s) => <label key={s.id} className="flex items-center gap-2 text-xs"><input type="checkbox" name="siteIds" value={s.id} /> {s.name}</label>)}
              </div>
            </fieldset>
            <Field label="Expires after (days)" name="expiresDays" hint="0 = never. Rotate keys at least yearly."><Input name="expiresDays" inputMode="numeric" defaultValue={365} /></Field>
          </SecretForm>
        </Card>
      )}
    </div>
  );
}

async function WebhooksTab({ orgId, tz, canEdit }: { orgId: string; tz: string; canEdit: boolean }) {
  const eps = await db.webhookEndpoint.findMany({ where: { orgId }, orderBy: { createdAt: "asc" }, include: { deliveries: { orderBy: { createdAt: "desc" }, take: 1 } } });
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Table head={["Endpoint", "Events", "Last delivery", "Status"]} empty="No webhook endpoints yet.">
          {eps.map((e) => {
            const last = e.deliveries[0];
            return (
              <tr key={e.id}>
                <Td><Link href={`/admin/integrations/webhooks/${e.id}`} className="break-all font-medium hover:text-brand-700">{e.url}</Link>{e.description && <p className="text-xs text-ink-500">{e.description}</p>}</Td>
                <Td className="text-xs">{e.events.join(", ")}</Td>
                <Td className="text-xs">{last ? <>{last.status} · {fmtDateTime(last.createdAt, tz)}</> : "—"}</Td>
                <Td>{e.active ? <Badge color="green">Active</Badge> : <Badge color="red">Disabled</Badge>}</Td>
              </tr>
            );
          })}
        </Table>
      </div>
      {canEdit && (
        <Card title="New endpoint">
          <SecretForm action={createWebhookAction} submit="Add endpoint" note="Use this secret to verify the X-PM-Signature header. It is shown only now; you can rotate it later." className="space-y-4">
            <Field label="URL" name="url" hint="https only. Must answer 2xx within 10 seconds."><Input name="url" required placeholder="https://erp.example.com/hooks/plant-metrics" /></Field>
            <Field label="Description" name="description"><Input name="description" placeholder="ERP integration" /></Field>
            <fieldset>
              <legend className="label">Events</legend>
              <div className="space-y-1">
                {Object.entries(EVENT_TYPES).map(([k, v]) => <label key={k} className="flex items-start gap-2 text-sm"><input type="checkbox" name="events" value={k} defaultChecked className="mt-1" /> <span><code className="text-xs">{k}</code><span className="block text-xs text-ink-500">{v}</span></span></label>)}
              </div>
            </fieldset>
          </SecretForm>
        </Card>
      )}
    </div>
  );
}
