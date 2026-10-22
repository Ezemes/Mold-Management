import type { SsoConnection } from "@prisma/client";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth";
import { dnsVerificationOff, oidcRedirectUri, samlAcsUrl, samlEntityId, type GroupMapping } from "@/lib/sso";
import { appUrl } from "@/lib/mail";
import { Badge, Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { deleteSsoAction, saveSsoAction, verifySsoDomainsAction } from "./actions";

type Lookups = { roles: { id: string; name: string; isSupplier: boolean }[]; sites: { id: string; code: string; name: string }[]; divisions: { id: string; code: string; name: string }[]; partners: { id: string; name: string }[] };

/** Stored mappings back into the editable "group | role | scope" lines. */
function mappingLines(maps: GroupMapping[], l: Lookups) {
  return maps
    .map((m) => {
      const role = l.roles.find((r) => r.id === m.roleId)?.name ?? "?";
      const scope =
        m.scopeType === "sites" ? `sites: ${m.scopeIds.map((id) => l.sites.find((s) => s.id === id)?.code || l.sites.find((s) => s.id === id)?.name).join(", ")}`
        : m.scopeType === "divisions" ? `divisions: ${m.scopeIds.map((id) => l.divisions.find((d) => d.id === id)?.code || l.divisions.find((d) => d.id === id)?.name).join(", ")}`
        : m.scopeType === "partner" ? `partner: ${l.partners.find((p) => p.id === m.partnerId)?.name}`
        : "all";
      return `${m.group} | ${role} | ${scope}`;
    })
    .join("\n");
}

function ConnectionForm({ c, l, canEdit }: { c?: SsoConnection; l: Lookups; canEdit: boolean }) {
  const proto = c?.protocol;
  return (
    <form action={saveSsoAction} className="grid gap-4 sm:grid-cols-2">
      {c && <input type="hidden" name="id" value={c.id} />}
      <Field label="Name" name="name"><Input name="name" defaultValue={c?.name ?? ""} placeholder="Microsoft Entra ID" /></Field>
      {!c ? (
        <Field label="Protocol" name="protocol"><Select name="protocol" options={{ oidc: "OpenID Connect (Entra ID, Google, Okta, Keycloak)", saml: "SAML 2.0" }} /></Field>
      ) : <Field label="Protocol"><p className="py-2 text-sm">{proto === "oidc" ? "OpenID Connect" : "SAML 2.0"}</p></Field>}
      <Field label="Email domains" name="emailDomains" hint="Comma separated. Each must be verified by DNS before sign-in works." className="sm:col-span-2"><Input name="emailDomains" defaultValue={c?.emailDomains.join(", ") ?? ""} placeholder="sharma.example" /></Field>
      {(!c || proto === "oidc") && (
        <>
          <Field label={`Issuer URL${c ? "" : " (OIDC)"}`} name="oidcIssuer"><Input name="oidcIssuer" defaultValue={c?.oidcIssuer ?? ""} placeholder="https://login.microsoftonline.com/<tenant>/v2.0" /></Field>
          <Field label={`Client ID${c ? "" : " (OIDC)"}`} name="oidcClientId"><Input name="oidcClientId" defaultValue={c?.oidcClientId ?? ""} /></Field>
          <Field label={`Client secret${c ? "" : " (OIDC)"}`} name="oidcClientSecret" hint={c ? "Leave blank to keep the stored secret (encrypted at rest)." : "Stored encrypted."}><Input name="oidcClientSecret" type="password" autoComplete="off" /></Field>
        </>
      )}
      {(!c || proto === "saml") && (
        <>
          <Field label={`IdP sign-in URL${c ? "" : " (SAML)"}`} name="samlEntryPoint"><Input name="samlEntryPoint" defaultValue={c?.samlEntryPoint ?? ""} placeholder="https://idp.example.com/sso/saml" /></Field>
          <Field label={`IdP entity ID${c ? "" : " (SAML)"}`} name="samlIdpIssuer" hint="Responses from any other issuer are refused."><Input name="samlIdpIssuer" defaultValue={c?.samlIdpIssuer ?? ""} /></Field>
          <Field label={`IdP signing certificate${c ? "" : " (SAML)"}`} name="samlIdpCert" hint={c?.samlIdpCert ? "Leave blank to keep the current certificate." : "PEM. Assertions must be signed with it."} className="sm:col-span-2"><Textarea name="samlIdpCert" rows={3} className="font-mono text-xs" placeholder="-----BEGIN CERTIFICATE-----" /></Field>
        </>
      )}
      <Field label="Groups claim / attribute" name="groupAttribute"><Input name="groupAttribute" defaultValue={c?.groupAttribute ?? "groups"} /></Field>
      <Field label="Default role" name="defaultRoleId" hint="For users in no mapped group. Blank = refuse them."><Select name="defaultRoleId" placeholder="None (refuse)" options={l.roles.filter((r) => !r.isSupplier).map((r) => [r.id, r.name] as [string, string])} defaultValue={c?.defaultRoleId ?? ""} /></Field>
      <Field label="Group mappings" name="groupMappings" hint="One per line: group | role | scope. Scope: all, sites: PUN1, CHE1, divisions: AUTO, or partner: Brightway Plastics. First match wins; role and scope are refreshed at every sign-in." className="sm:col-span-2">
        <Textarea name="groupMappings" rows={5} className="font-mono text-xs" defaultValue={c ? mappingLines(c.groupMappings as unknown as GroupMapping[], l) : ""} placeholder={"PM-Admins | Org Admin | all\nPM-Pune-Techs | Technician | sites: PUN1, PUN-TS\nBrightway-Staff | Supplier User | partner: Brightway Plastics"} />
      </Field>
      <div className="space-y-1 text-sm sm:col-span-2">
        <label className="flex items-center gap-2"><input type="checkbox" name="jit" defaultChecked={c?.jitProvisioning ?? true} /> Create accounts on first sign-in</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="enforce" defaultChecked={c?.enforce ?? false} /> Require single sign-on for these domains (org admins can still use a password)</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={c?.enabled ?? false} /> Enabled</label>
      </div>
      {canEdit && <div className="sm:col-span-2"><SubmitButton>{c ? "Save connection" : "Add connection"}</SubmitButton></div>}
    </form>
  );
}

export async function SsoTab({ ctx }: { ctx: Ctx }) {
  const canEdit = ctx.can("integrations", "edit");
  const [conns, roles, sites, divisions, partners] = await Promise.all([
    db.ssoConnection.findMany({ where: { orgId: ctx.org.id }, orderBy: { createdAt: "asc" } }),
    db.role.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: "asc" } }),
    db.site.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: "asc" } }),
    db.division.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: "asc" } }),
    db.partner.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: "asc" } }),
  ]);
  const l: Lookups = { roles, sites, divisions, partners };
  return (
    <div className="space-y-6">
      {dnsVerificationOff() && <Notice tone="warn">Domain verification is switched off on this server (SSO_SKIP_DOMAIN_VERIFICATION). Use this only in test environments.</Notice>}
      {conns.map((c) => (
        <Card key={c.id} title={<span className="flex items-center gap-2">{c.name} {c.enabled ? <Badge color="green">Enabled</Badge> : <Badge color="gray">Off</Badge>} {c.enforce && <Badge color="blue">Required</Badge>}</span>}>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2"><ConnectionForm c={c} l={l} canEdit={canEdit} /></div>
            <div className="space-y-5 text-sm">
              <div>
                <p className="font-medium">Give your identity provider</p>
                {c.protocol === "oidc" ? (
                  <p className="mt-1 text-xs">Redirect URI: <code className="break-all rounded bg-gray-100 px-1">{oidcRedirectUri()}</code><br />Scopes: openid email profile, plus a “{c.groupAttribute}” claim.</p>
                ) : (
                  <p className="mt-1 text-xs">
                    ACS URL: <code className="break-all rounded bg-gray-100 px-1">{samlAcsUrl()}</code><br />
                    Entity ID: <code className="break-all rounded bg-gray-100 px-1">{samlEntityId(c)}</code><br />
                    <a href={`/api/sso/saml/metadata?connection=${c.id}`} className="text-brand-700 hover:underline">Download SP metadata</a> · sign assertions; send email and “{c.groupAttribute}” attributes.
                  </p>
                )}
              </div>
              <div>
                <p className="font-medium">Domain verification</p>
                <p className="mt-1 text-xs text-ink-500">Add a TXT record for each domain, then check.</p>
                <ul className="mt-2 space-y-2">
                  {c.emailDomains.map((d) => (
                    <li key={d} className="text-xs">
                      <span className="font-medium">{d}</span> {c.verifiedDomains.includes(d) ? <Badge color="green">verified</Badge> : <Badge color="amber">not verified</Badge>}
                      {!c.verifiedDomains.includes(d) && <span className="mt-0.5 block break-all text-ink-500">_plant-metrics.{d} TXT “pm-verify={c.verifyToken}”</span>}
                    </li>
                  ))}
                </ul>
                {canEdit && <form action={verifySsoDomainsAction} className="mt-2"><input type="hidden" name="id" value={c.id} /><SubmitButton size="sm" variant="secondary">Check DNS</SubmitButton></form>}
              </div>
              {c.enabled && <a href={appUrl(`/api/sso/start?connection=${c.id}`)} className="block text-xs text-brand-700 hover:underline">Test sign-in →</a>}
              {canEdit && <form action={deleteSsoAction}><input type="hidden" name="id" value={c.id} /><SubmitButton size="sm" variant="danger" confirm="Delete this connection?">Delete connection</SubmitButton></form>}
            </div>
          </div>
        </Card>
      ))}
      {canEdit && (
        <Card title="Add a connection">
          <ConnectionForm l={l} canEdit={canEdit} />
        </Card>
      )}
    </div>
  );
}
