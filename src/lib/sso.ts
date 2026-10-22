import "server-only";
import { createHash } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { SAML, ValidateInResponseTo, type CacheItem, type CacheProvider } from "@node-saml/node-saml";
import type { SsoConnection } from "@prisma/client";
import { db } from "./db";
import { audit } from "./audit";
import { appUrl } from "./mail";
import { decryptSecret, randomToken } from "./crypto";
import { emailDomain, groupsFrom, resolveAccess, safeReturnTo, type GroupMapping } from "./sso.pure";

export * from "./sso.pure";

export class SsoError extends Error {}

const STATE_TTL_MS = 10 * 60_000;
export const oidcRedirectUri = () => appUrl("/api/sso/oidc/callback");
export const samlAcsUrl = () => appUrl("/api/sso/saml/acs");
export const samlEntityId = (c: { id: string }) => appUrl(`/sso/${c.id}`);

/** The enabled connection that owns an email's verified domain (a domain can be verified by one organisation only). */
export async function connectionForEmail(email: string) {
  const domain = emailDomain(email);
  if (!domain) return null;
  return db.ssoConnection.findFirst({ where: { enabled: true, verifiedDomains: { has: domain } } });
}

/** Test environments only: trust listed domains without the DNS check. The admin screen warns while this is on. */
export const dnsVerificationOff = () => process.env.SSO_SKIP_DOMAIN_VERIFICATION === "1";

/**
 * Check each listed domain for the TXT record "_plant-metrics.<domain>" = "pm-verify=<token>". Proving the
 * domain stops an organisation pointing SSO at addresses it doesn't own (e.g. gmail.com) to take over accounts.
 */
export async function verifyDomains(c: SsoConnection) {
  const results: Record<string, string> = {};
  const verified: string[] = [];
  for (const d of c.emailDomains) {
    const owner = await db.ssoConnection.findFirst({ where: { verifiedDomains: { has: d }, NOT: { orgId: c.orgId } } });
    if (owner) { results[d] = "already verified by another organisation"; continue; }
    if (dnsVerificationOff()) { verified.push(d); results[d] = "trusted without DNS (test setting)"; continue; }
    try {
      const txt = (await resolveTxt(`_plant-metrics.${d}`)).map((r) => r.join(""));
      if (txt.includes(`pm-verify=${c.verifyToken}`)) { verified.push(d); results[d] = "verified"; }
      else results[d] = "TXT record found but the value doesn't match";
    } catch {
      results[d] = "no TXT record yet";
    }
  }
  await db.ssoConnection.update({ where: { id: c.id }, data: { verifiedDomains: verified } });
  return { verified, results };
}

/** Password sign-in is refused for an enforced domain, except for that organisation's admins (break-glass). */
export async function passwordBlockedBySso(userId: string, email: string) {
  const c = await connectionForEmail(email);
  if (!c?.enforce) return null;
  const m = await db.membership.findFirst({ where: { userId, orgId: c.orgId, status: "active" }, include: { role: true } });
  return m?.role.key === "org_admin" ? null : c;
}

// ─── OIDC ───────────────────────────────────────────────────────────────────

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };
const discoveryCache = new Map<string, { at: number; d: Discovery }>();

export async function discover(issuer: string): Promise<Discovery> {
  const hit = discoveryCache.get(issuer);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.d;
  const res = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new SsoError(`Could not read the identity provider's configuration (HTTP ${res.status}).`);
  const d = (await res.json()) as Discovery;
  if (!d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri) throw new SsoError("The identity provider's configuration is incomplete.");
  // The issuer in the document must be the one configured (OIDC Discovery §4.3).
  if (d.issuer.replace(/\/$/, "") !== issuer.replace(/\/$/, "")) throw new SsoError("The identity provider's issuer does not match the configured issuer.");
  discoveryCache.set(issuer, { at: Date.now(), d });
  return d;
}

const b64url = (b: Buffer) => b.toString("base64url");

/** Where to send the browser to start sign-in. State, nonce and PKCE verifier are kept server-side for one use. */
export async function startSignIn(c: SsoConnection, returnTo: string): Promise<{ url: string; state: string }> {
  const id = randomToken(24);
  if (c.protocol === "oidc") {
    const d = await discover(c.oidcIssuer);
    const nonce = randomToken(16);
    const codeVerifier = randomToken(48);
    await db.ssoState.create({ data: { id, connectionId: c.id, nonce, codeVerifier, returnTo: safeReturnTo(returnTo), expiresAt: new Date(Date.now() + STATE_TTL_MS) } });
    const u = new URL(d.authorization_endpoint);
    u.search = new URLSearchParams({
      response_type: "code", client_id: c.oidcClientId, redirect_uri: oidcRedirectUri(), scope: "openid email profile", state: id, nonce,
      code_challenge: b64url(createHash("sha256").update(codeVerifier).digest()), code_challenge_method: "S256",
    }).toString();
    return { url: u.toString(), state: id };
  }
  await db.ssoState.create({ data: { id, connectionId: c.id, returnTo: safeReturnTo(returnTo), expiresAt: new Date(Date.now() + STATE_TTL_MS) } });
  return { url: await samlFor(c).getAuthorizeUrlAsync(id, undefined, {}), state: id };
}

/** Cookie binding a sign-in to the browser that started it (stops login CSRF). SameSite=None: SAML posts cross-site. */
export const STATE_COOKIE = "pm_sso_state";
export const stateCookieOptions = { httpOnly: true, secure: true, sameSite: "none" as const, path: "/api/sso", maxAge: STATE_TTL_MS / 1000 };

/** Load and delete a state record: each sign-in attempt can be completed once, in the browser that started it. */
async function takeState(id: string | null, cookieState: string | undefined) {
  if (!id) throw new SsoError("Missing sign-in state. Start again.");
  const s = await db.ssoState.findUnique({ where: { id } });
  if (!s) throw new SsoError("This sign-in link has already been used or has expired. Start again.");
  await db.ssoState.delete({ where: { id } });
  if (s.expiresAt < new Date()) throw new SsoError("The sign-in took too long. Start again.");
  if (!cookieState || cookieState !== id) throw new SsoError("This sign-in was started in a different browser. Start again here.");
  const c = await db.ssoConnection.findUnique({ where: { id: s.connectionId } });
  if (!c?.enabled) throw new SsoError("Single sign-on is not enabled for this organisation.");
  return { s, c };
}

export async function finishOidc(params: URLSearchParams, cookieState: string | undefined) {
  if (params.get("error")) throw new SsoError(`The identity provider refused sign-in: ${params.get("error_description") ?? params.get("error")}`);
  const { s, c } = await takeState(params.get("state"), cookieState);
  if (c.protocol !== "oidc") throw new SsoError("Wrong sign-in protocol.");
  const code = params.get("code");
  if (!code) throw new SsoError("No authorisation code was returned.");
  const d = await discover(c.oidcIssuer);
  const res = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${encodeURIComponent(c.oidcClientId)}:${encodeURIComponent(decryptSecret(c.oidcClientSecretEnc))}`).toString("base64")}` },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: oidcRedirectUri(), code_verifier: s.codeVerifier }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new SsoError(`The identity provider rejected the code exchange (HTTP ${res.status}).`);
  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) throw new SsoError("The identity provider did not return an ID token.");
  let claims: JWTPayload;
  try {
    ({ payload: claims } = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(d.jwks_uri)), { issuer: d.issuer, audience: c.oidcClientId, maxTokenAge: "10m", clockTolerance: 60 }));
  } catch (e) {
    throw new SsoError(`The ID token could not be verified: ${(e as Error).message}`);
  }
  if (claims.nonce !== s.nonce) throw new SsoError("The ID token does not belong to this sign-in.");
  if (claims.email_verified === false) throw new SsoError("Your email address is not verified with the identity provider.");
  return completeSignIn(c, {
    subject: String(claims.sub ?? ""),
    email: String(claims.email ?? ""),
    firstName: String(claims.given_name ?? ""),
    lastName: String(claims.family_name ?? ""),
    groups: groupsFrom(claims[c.groupAttribute]),
  }, s.returnTo);
}

// ─── SAML ───────────────────────────────────────────────────────────────────

/** node-saml's request-ID cache, stored in the database so InResponseTo works across processes. */
class DbCache implements CacheProvider {
  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    await db.ssoState.upsert({ where: { id: `saml:${key}` }, create: { id: `saml:${key}`, connectionId: "", requestId: value, expiresAt: new Date(Date.now() + STATE_TTL_MS) }, update: { requestId: value } });
    return { value, createdAt: Date.now() };
  }
  async getAsync(key: string) {
    const s = await db.ssoState.findUnique({ where: { id: `saml:${key}` } });
    return s && s.expiresAt > new Date() ? s.requestId : null;
  }
  async removeAsync(key: string | null) {
    if (!key) return null;
    const s = await db.ssoState.deleteMany({ where: { id: `saml:${key}` } });
    return s.count ? key : null;
  }
}

export function samlFor(c: SsoConnection) {
  return new SAML({
    callbackUrl: samlAcsUrl(),
    entryPoint: c.samlEntryPoint,
    issuer: samlEntityId(c),
    audience: samlEntityId(c),
    idpCert: c.samlIdpCert,
    idpIssuer: c.samlIdpIssuer || undefined,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: STATE_TTL_MS,
    cacheProvider: new DbCache(),
    acceptedClockSkewMs: 60_000,
    identifierFormat: null,
    disableRequestedAuthnContext: true,
  });
}

const SAML_EMAIL = ["email", "mail", "urn:oid:0.9.2342.19200300.100.1.3", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"];
const SAML_GIVEN = ["firstName", "givenName", "urn:oid:2.5.4.42", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"];
const SAML_SURNAME = ["lastName", "sn", "urn:oid:2.5.4.4", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"];

export async function finishSaml(form: FormData, cookieState: string | undefined) {
  const { c, s } = await takeState(typeof form.get("RelayState") === "string" ? String(form.get("RelayState")) : null, cookieState);
  if (c.protocol !== "saml") throw new SsoError("Wrong sign-in protocol.");
  let profile: Record<string, unknown> | null;
  try {
    ({ profile } = (await samlFor(c).validatePostResponseAsync({ SAMLResponse: String(form.get("SAMLResponse") ?? "") })) as { profile: Record<string, unknown> | null });
  } catch (e) {
    throw new SsoError(`The SAML response could not be verified: ${(e as Error).message}`);
  }
  if (!profile) throw new SsoError("The SAML response contained no user.");
  const pick = (names: string[]) => { for (const n of names) { const v = profile![n]; if (typeof v === "string" && v) return v; } return ""; };
  const nameID = String(profile.nameID ?? "");
  return completeSignIn(c, {
    subject: nameID,
    email: pick(SAML_EMAIL) || (nameID.includes("@") ? nameID : ""),
    firstName: pick(SAML_GIVEN),
    lastName: pick(SAML_SURNAME),
    groups: groupsFrom(profile[c.groupAttribute]),
  }, s.returnTo);
}

// ─── Shared ─────────────────────────────────────────────────────────────────

type Identity = { subject: string; email: string; firstName: string; lastName: string; groups: string[] };

/**
 * Turn a verified identity into a user and membership. The email must belong to one of the connection's
 * domains; the role and scope come from the group mappings and are refreshed at every sign-in.
 */
export async function completeSignIn(c: SsoConnection, id: Identity, returnTo: string) {
  const email = id.email.trim().toLowerCase();
  if (!id.subject) throw new SsoError("The identity provider sent no user identifier.");
  if (!email || !c.verifiedDomains.includes(emailDomain(email))) throw new SsoError(`The email ${email || "(none)"} is not in a verified domain of this connection.`);
  const access = resolveAccess(id.groups, c.groupMappings as unknown as GroupMapping[], c.defaultRoleId);
  if (!access) throw new SsoError("Your account is not in any group that has access to Plant Metrics. Ask your administrator.");
  const role = await db.role.findFirst({ where: { id: access.roleId, orgId: c.orgId } });
  if (!role) throw new SsoError("The mapped role no longer exists. Ask your administrator to fix the single sign-on group mapping.");

  const linked = await db.ssoIdentity.findUnique({ where: { connectionId_subject: { connectionId: c.id, subject: id.subject } }, include: { user: true } });
  let user = linked?.user ?? (await db.user.findUnique({ where: { email } }));
  const membership = user ? await db.membership.findUnique({ where: { userId_orgId: { userId: user.id, orgId: c.orgId } } }) : null;
  if (!membership && !c.jitProvisioning) throw new SsoError("You don't have an account in this organisation yet. Ask your administrator to invite you.");
  if (user?.status === "suspended" || membership?.status === "suspended") throw new SsoError("Your account is suspended. Contact your administrator.");

  const scope = role.isSupplier ? { scopeType: "partner", scopeIds: [], partnerId: access.partnerId } : { scopeType: access.scopeType, scopeIds: access.scopeIds, partnerId: null };
  if (role.isSupplier && !scope.partnerId) throw new SsoError("The group mapping gives a supplier role without naming the partner. Ask your administrator.");
  user = await db.$transaction(async (tx) => {
    const u = user
      ? await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), emailVerifiedAt: user.emailVerifiedAt ?? new Date(), ...(id.firstName && !user.firstName ? { firstName: id.firstName } : {}), ...(id.lastName && !user.lastName ? { lastName: id.lastName } : {}) } })
      : await tx.user.create({ data: { email, firstName: id.firstName, lastName: id.lastName, emailVerifiedAt: new Date(), lastLoginAt: new Date() } });
    const before = membership ? { roleId: membership.roleId, scopeType: membership.scopeType, scopeIds: membership.scopeIds, partnerId: membership.partnerId } : null;
    await tx.membership.upsert({ where: { userId_orgId: { userId: u.id, orgId: c.orgId } }, create: { userId: u.id, orgId: c.orgId, roleId: role.id, ...scope }, update: { roleId: role.id, ...scope } });
    await tx.ssoIdentity.upsert({ where: { connectionId_subject: { connectionId: c.id, subject: id.subject } }, create: { connectionId: c.id, subject: id.subject, userId: u.id }, update: { userId: u.id, lastLoginAt: new Date() } });
    await audit({ orgId: c.orgId, userId: u.id }, { action: membership ? "sso_login" : "sso_provisioned", entityType: "user", entityId: u.id, entityLabel: email, before, after: { role: role.name, ...scope, groups: id.groups.slice(0, 20), connection: c.name } }, tx);
    return u;
  });
  return { userId: user.id, orgId: c.orgId, returnTo: safeReturnTo(returnTo) };
}
