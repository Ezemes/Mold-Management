"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertCan, requireOrg } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { str } from "@/lib/forms";
import { API_SCOPES, createApiKey, type ApiScope } from "@/lib/api";
import { encryptSecret, randomToken } from "@/lib/crypto";
import { checkWebhookUrl, EVENT_TYPES, redeliver } from "@/lib/webhooks";
import { discover, parseDomains, parseMappingLines, validDomain, verifyDomains, type GroupMapping } from "@/lib/sso";

export type SecretState = { secret?: string; label?: string; error?: string };

function back(path: string, msg: string, kind: "error" | "ok" = "error"): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
}

async function admin() {
  const ctx = await requireOrg();
  assertCan(ctx, "integrations", "edit");
  return ctx;
}

// ─── API keys ───────────────────────────────────────────────────────────────

/** Returns the token to the form once; only its hash is stored. */
export async function createApiKeyAction(_prev: SecretState, fd: FormData): Promise<SecretState> {
  const ctx = await admin();
  const name = str(fd, "name");
  if (name.length < 3) return { error: "Name the key after the system that will use it (e.g. “MES shot counter feed”)." };
  const scopes = fd.getAll("scopes").map(String).filter((s): s is ApiScope => s in API_SCOPES);
  if (!scopes.length) return { error: "Choose at least one scope." };
  const siteIds = fd.getAll("siteIds").map(String).filter(Boolean);
  if (siteIds.length && (await db.site.count({ where: { orgId: ctx.org.id, id: { in: siteIds } } })) !== siteIds.length) return { error: "Choose sites from your organisation." };
  const days = Number(str(fd, "expiresDays") || "0");
  if (!Number.isInteger(days) || days < 0 || days > 3650) return { error: "Expiry must be 0 (never) to 3,650 days." };
  const expiresAt = days ? new Date(Date.now() + days * 86_400_000) : null;
  const { key, token } = await createApiKey(ctx.org.id, name, scopes, siteIds, ctx.user.id, expiresAt);
  await audit(ctx, { action: "api_key_created", entityType: "api_key", entityId: key.id, entityLabel: name, after: { scopes, siteIds, expiresAt, prefix: key.prefix } });
  return { secret: token, label: name };
}

export async function revokeApiKeyAction(fd: FormData) {
  const ctx = await admin();
  const k = await db.apiKey.findFirst({ where: { id: str(fd, "id"), orgId: ctx.org.id, revokedAt: null } });
  if (!k) back("/admin/integrations", "Key not found.");
  await db.$transaction(async (tx) => {
    await tx.apiKey.update({ where: { id: k.id }, data: { revokedAt: new Date() } });
    await audit(ctx, { action: "api_key_revoked", entityType: "api_key", entityId: k.id, entityLabel: k.name }, tx);
  });
  back("/admin/integrations", `Key “${k.name}” revoked. Requests with it now fail.`, "ok");
}

// ─── Webhooks ───────────────────────────────────────────────────────────────

function readEvents(fd: FormData) {
  return fd.getAll("events").map(String).filter((e) => e in EVENT_TYPES);
}

export async function createWebhookAction(_prev: SecretState, fd: FormData): Promise<SecretState> {
  const ctx = await admin();
  const url = str(fd, "url");
  const bad = checkWebhookUrl(url, process.env.WEBHOOK_ALLOW_HTTP === "1");
  if (bad) return { error: bad };
  const events = readEvents(fd);
  if (!events.length) return { error: "Choose at least one event." };
  if ((await db.webhookEndpoint.count({ where: { orgId: ctx.org.id } })) >= 20) return { error: "At most 20 webhook endpoints per organisation." };
  const secret = `whsec_${randomToken(24)}`;
  const ep = await db.webhookEndpoint.create({ data: { orgId: ctx.org.id, url, description: str(fd, "description"), events, secretEnc: encryptSecret(secret), createdById: ctx.user.id } });
  await audit(ctx, { action: "webhook_created", entityType: "webhook", entityId: ep.id, entityLabel: url, after: { events } });
  return { secret, label: url };
}

export async function rotateWebhookSecretAction(_prev: SecretState, fd: FormData): Promise<SecretState> {
  const ctx = await admin();
  const ep = await db.webhookEndpoint.findFirst({ where: { id: str(fd, "id"), orgId: ctx.org.id } });
  if (!ep) return { error: "Endpoint not found." };
  const secret = `whsec_${randomToken(24)}`;
  await db.webhookEndpoint.update({ where: { id: ep.id }, data: { secretEnc: encryptSecret(secret) } });
  await audit(ctx, { action: "webhook_secret_rotated", entityType: "webhook", entityId: ep.id, entityLabel: ep.url });
  return { secret, label: ep.url };
}

export async function updateWebhookAction(fd: FormData) {
  const ctx = await admin();
  const ep = await db.webhookEndpoint.findFirst({ where: { id: str(fd, "id"), orgId: ctx.org.id } });
  const path = `/admin/integrations/webhooks/${str(fd, "id")}`;
  if (!ep) back("/admin/integrations?tab=webhooks", "Endpoint not found.");
  const events = readEvents(fd);
  if (!events.length) back(path, "Choose at least one event.");
  const active = str(fd, "active") === "on";
  await db.$transaction(async (tx) => {
    // Re-enabling clears the failure count that disabled it.
    await tx.webhookEndpoint.update({ where: { id: ep.id }, data: { events, description: str(fd, "description"), active, ...(active && !ep.active ? { consecutiveFailures: 0, disabledReason: "" } : {}) } });
    await audit(ctx, { action: "webhook_updated", entityType: "webhook", entityId: ep.id, entityLabel: ep.url, before: { events: ep.events, active: ep.active }, after: { events, active } }, tx);
  });
  back(path, "Saved.", "ok");
}

export async function deleteWebhookAction(fd: FormData) {
  const ctx = await admin();
  const ep = await db.webhookEndpoint.findFirst({ where: { id: str(fd, "id"), orgId: ctx.org.id } });
  if (!ep) back("/admin/integrations?tab=webhooks", "Endpoint not found.");
  await db.$transaction(async (tx) => {
    await tx.webhookEndpoint.delete({ where: { id: ep.id } });
    await audit(ctx, { action: "webhook_deleted", entityType: "webhook", entityId: ep.id, entityLabel: ep.url }, tx);
  });
  back("/admin/integrations?tab=webhooks", "Endpoint deleted.", "ok");
}

/** Send a "ping" event to one endpoint and report the result straight away. */
export async function pingWebhookAction(fd: FormData) {
  const ctx = await admin();
  const ep = await db.webhookEndpoint.findFirst({ where: { id: str(fd, "id"), orgId: ctx.org.id } });
  const path = `/admin/integrations/webhooks/${str(fd, "id")}`;
  if (!ep) back("/admin/integrations?tab=webhooks", "Endpoint not found.");
  if (!ep.active) back(path, "Enable the endpoint first.");
  // A ping goes only to this endpoint: create the event, then a single delivery.
  const ev = await db.outboundEvent.create({ data: { orgId: ctx.org.id, type: "ping", data: { message: "Test event from Plant Metrics", sent_by: ctx.user.email } } });
  const d = await db.webhookDelivery.create({ data: { eventId: ev.id, endpointId: ep.id, nextAttemptAt: new Date(Date.now() + 5 * 60_000) } });
  const ok = await redeliver(d.id);
  const after = await db.webhookDelivery.findUnique({ where: { id: d.id } });
  back(path, ok ? `Test event delivered (HTTP ${after?.lastStatusCode}).` : `Test event failed: ${after?.lastError || "no response"}. It will be retried.`, ok ? "ok" : "error");
}

export async function redeliverAction(fd: FormData) {
  const ctx = await admin();
  const d = await db.webhookDelivery.findFirst({ where: { id: str(fd, "deliveryId"), endpoint: { orgId: ctx.org.id } } });
  if (!d) back("/admin/integrations?tab=webhooks", "Delivery not found.");
  const ok = await redeliver(d.id);
  back(`/admin/integrations/webhooks/${d.endpointId}`, ok ? "Delivered." : "Delivery failed again; see the error below.", ok ? "ok" : "error");
}

// ─── Single sign-on ─────────────────────────────────────────────────────────

const httpsOrLocal = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" || (x.protocol === "http:" && ["localhost", "127.0.0.1"].includes(x.hostname)); } catch { return false; } };

/** Turn PEM or bare base64 into the certificate body node-saml expects. */
function normaliseCert(raw: string) {
  return raw.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
}

async function resolveMappings(orgId: string, src: string) {
  const { lines, errors } = parseMappingLines(src);
  const [roles, sites, divisions, partners] = await Promise.all([
    db.role.findMany({ where: { orgId } }),
    db.site.findMany({ where: { orgId } }),
    db.division.findMany({ where: { orgId } }),
    db.partner.findMany({ where: { orgId } }),
  ]);
  const eq = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();
  const out: GroupMapping[] = [];
  for (const l of lines) {
    const role = roles.find((r) => eq(r.key, l.role) || eq(r.name, l.role));
    if (!role) { errors.push(`“${l.group}”: no role called “${l.role}”.`); continue; }
    let scopeIds: string[] = [];
    let partnerId: string | null = null;
    if (l.scopeType === "sites") scopeIds = l.refs.map((ref) => sites.find((s) => eq(s.code, ref) || eq(s.name, ref))?.id ?? "");
    if (l.scopeType === "divisions") scopeIds = l.refs.map((ref) => divisions.find((d) => eq(d.code, ref) || eq(d.name, ref))?.id ?? "");
    if (l.scopeType === "partner") partnerId = partners.find((p) => eq(p.name, l.refs[0]))?.id ?? "";
    if (scopeIds.includes("") || partnerId === "") { errors.push(`“${l.group}”: ${l.scopeType} not found: ${l.refs.join(", ")}.`); continue; }
    if (role.isSupplier !== (l.scopeType === "partner")) { errors.push(`“${l.group}”: supplier roles need “partner: …”, and only supplier roles can use it.`); continue; }
    out.push({ group: l.group, roleId: role.id, scopeType: l.scopeType, scopeIds, partnerId });
  }
  return { mappings: out, errors };
}

export async function saveSsoAction(fd: FormData) {
  const ctx = await admin();
  const id = str(fd, "id");
  const existing = id ? await db.ssoConnection.findFirst({ where: { id, orgId: ctx.org.id } }) : null;
  if (id && !existing) back("/admin/integrations?tab=sso", "Connection not found.");
  const ret = "/admin/integrations?tab=sso";
  const protocol = existing?.protocol ?? (str(fd, "protocol") === "saml" ? "saml" : "oidc");
  const name = str(fd, "name") || (protocol === "oidc" ? "OpenID Connect" : "SAML");
  const domains = parseDomains(str(fd, "emailDomains"));
  if (!domains.length || domains.some((d) => !validDomain(d))) back(ret, "List the email domains this connection signs in, e.g. sharma.example.");
  const { mappings, errors } = await resolveMappings(ctx.org.id, str(fd, "groupMappings"));
  if (errors.length) back(ret, `Group mappings: ${errors.slice(0, 4).join(" ")}`);
  const defaultRoleId = str(fd, "defaultRoleId") || null;
  if (defaultRoleId) {
    const r = await db.role.findFirst({ where: { id: defaultRoleId, orgId: ctx.org.id } });
    if (!r || r.isSupplier) back(ret, "The default role must be an internal role.");
  }
  if (!mappings.length && !defaultRoleId) back(ret, "Add at least one group mapping or a default role, otherwise nobody can sign in.");
  const data: Record<string, unknown> = {
    name, emailDomains: domains, enforce: str(fd, "enforce") === "on", jitProvisioning: str(fd, "jit") === "on", defaultRoleId,
    groupAttribute: str(fd, "groupAttribute") || "groups", groupMappings: mappings,
    // Removing a domain removes its verification; new domains must be verified.
    verifiedDomains: (existing?.verifiedDomains ?? []).filter((d) => domains.includes(d)),
  };
  if (protocol === "oidc") {
    const issuer = str(fd, "oidcIssuer").replace(/\/$/, "");
    if (!httpsOrLocal(issuer)) back(ret, "The issuer must be an https URL.");
    if (!str(fd, "oidcClientId")) back(ret, "Enter the client ID.");
    if (!existing && !str(fd, "oidcClientSecret")) back(ret, "Enter the client secret.");
    let problem = "";
    try { await discover(issuer); } catch (e) { problem = (e as Error).message; }
    if (problem) back(ret, `Couldn't use that issuer: ${problem}`);
    Object.assign(data, { oidcIssuer: issuer, oidcClientId: str(fd, "oidcClientId"), ...(str(fd, "oidcClientSecret") ? { oidcClientSecretEnc: encryptSecret(str(fd, "oidcClientSecret")) } : {}) });
  } else {
    const entry = str(fd, "samlEntryPoint");
    if (!httpsOrLocal(entry)) back(ret, "The IdP sign-in URL must be an https URL.");
    const cert = normaliseCert(str(fd, "samlIdpCert"));
    if (!existing?.samlIdpCert && !cert) back(ret, "Paste the IdP's signing certificate.");
    if (cert && !/^[A-Za-z0-9+/=]{200,}$/.test(cert)) back(ret, "That doesn't look like a PEM certificate.");
    Object.assign(data, { samlEntryPoint: entry, samlIdpIssuer: str(fd, "samlIdpIssuer"), ...(cert ? { samlIdpCert: cert } : {}) });
  }
  const wantEnabled = str(fd, "enabled") === "on";
  const verified = data.verifiedDomains as string[];
  data.enabled = wantEnabled && verified.length > 0;
  const saved = await db.$transaction(async (tx) => {
    const c = existing
      ? await tx.ssoConnection.update({ where: { id: existing.id }, data: data as never })
      : await tx.ssoConnection.create({ data: { ...(data as object), orgId: ctx.org.id, protocol, verifyToken: randomToken(18) } as never });
    await audit(ctx, { action: existing ? "sso_updated" : "sso_created", entityType: "sso", entityId: c.id, entityLabel: name, after: { protocol, domains, enforce: data.enforce, enabled: data.enabled, mappings: mappings.length } }, tx);
    return c;
  });
  back(ret, wantEnabled && !saved.enabled ? "Saved, but not enabled: verify at least one domain first." : "Single sign-on saved.", wantEnabled && !saved.enabled ? "error" : "ok");
}

export async function verifySsoDomainsAction(fd: FormData) {
  const ctx = await admin();
  const c = await db.ssoConnection.findFirst({ where: { id: str(fd, "id"), orgId: ctx.org.id } });
  if (!c) back("/admin/integrations?tab=sso", "Connection not found.");
  const r = await verifyDomains(c);
  await audit(ctx, { action: "sso_domains_checked", entityType: "sso", entityId: c.id, entityLabel: c.name, after: r.results });
  back("/admin/integrations?tab=sso", Object.entries(r.results).map(([d, s]) => `${d}: ${s}`).join("; "), r.verified.length ? "ok" : "error");
}

export async function deleteSsoAction(fd: FormData) {
  const ctx = await admin();
  const c = await db.ssoConnection.findFirst({ where: { id: str(fd, "id"), orgId: ctx.org.id } });
  if (!c) back("/admin/integrations?tab=sso", "Connection not found.");
  await db.$transaction(async (tx) => {
    await tx.ssoConnection.delete({ where: { id: c.id } });
    await audit(ctx, { action: "sso_deleted", entityType: "sso", entityId: c.id, entityLabel: c.name }, tx);
  });
  back("/admin/integrations?tab=sso", "Connection deleted. Users sign in with passwords again (they may need to reset one).", "ok");
}
