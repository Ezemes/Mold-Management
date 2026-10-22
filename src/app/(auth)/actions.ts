"use server";

import { redirect } from "next/navigation";
import { passwordBlockedBySso } from "@/lib/sso";
import { db } from "@/lib/db";
import { createSession, destroySession, hashPassword, PASSWORD_RULE, requireUser, validPassword, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { appUrl, sendMail, showDevSecrets } from "@/lib/mail";
import { setupOrganisation } from "@/lib/org-setup";
import { str, token } from "@/lib/forms";

function fail(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
}

async function issueOtp(userId: string, email: string) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await db.user.update({ where: { id: userId }, data: { otpCode: code, otpExpiresAt: new Date(Date.now() + 15 * 60_000) } });
  await sendMail(email, "Your Plant Metrics verification code", `Your code is ${code}. It expires in 15 minutes.`);
}

export async function registerAction(fd: FormData) {
  const email = str(fd, "email").toLowerCase();
  const password = str(fd, "password");
  const firstName = str(fd, "first_name");
  const orgName = str(fd, "org_name");
  const siteName = str(fd, "site_name");
  if (!email.includes("@") || !firstName || !orgName || !siteName) fail("/register", "Please fill in all required fields.");
  if (!validPassword(password)) fail("/register", PASSWORD_RULE);
  if (await db.user.findUnique({ where: { email } })) fail("/register", "An account with this email already exists. Sign in instead.");

  const passwordHash = await hashPassword(password);
  const user = await db.$transaction(async (tx) => {
    const { org, adminRole } = await setupOrganisation(tx, { name: orgName, siteName, city: str(fd, "city"), state: str(fd, "state") });
    const u = await tx.user.create({ data: { email, passwordHash, firstName, lastName: str(fd, "last_name"), phone: str(fd, "phone") } });
    await tx.membership.create({ data: { userId: u.id, orgId: org.id, roleId: adminRole.id } });
    await audit({ orgId: org.id, userId: u.id }, { action: "created", entityType: "organisation", entityId: org.id, entityLabel: org.name, after: { name: org.name } }, tx);
    return u;
  });
  await issueOtp(user.id, email);
  redirect(`/verify-email?email=${encodeURIComponent(email)}`);
}

export async function verifyOtpAction(fd: FormData) {
  const email = str(fd, "email").toLowerCase();
  const back = `/verify-email?email=${encodeURIComponent(email)}`;
  const user = await db.user.findUnique({ where: { email } });
  if (!user?.otpCode || user.otpCode !== str(fd, "code") || !user.otpExpiresAt || user.otpExpiresAt < new Date()) fail(back, "That code is invalid or has expired.");
  await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), otpCode: null, otpExpiresAt: null, lastLoginAt: new Date() } });
  const m = await db.membership.findFirst({ where: { userId: user.id, status: "active" }, orderBy: { createdAt: "asc" } });
  await createSession(user.id, m?.orgId ?? null);
  redirect("/dashboard");
}

export async function resendOtpAction(fd: FormData) {
  const email = str(fd, "email").toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (user && !user.emailVerifiedAt) await issueOtp(user.id, email);
  redirect(`/verify-email?email=${encodeURIComponent(email)}&ok=${encodeURIComponent("A new code has been sent.")}`);
}

export async function loginAction(fd: FormData) {
  const email = str(fd, "email").toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(str(fd, "password"), user.passwordHash))) fail("/login", "Incorrect email or password.");
  if (user.status !== "active") fail("/login", "This account is suspended. Contact your administrator.");
  if (await passwordBlockedBySso(user.id, email)) fail("/login", "Your organisation signs in with single sign-on. Use “Sign in with single sign-on” below.");
  if (!user.emailVerifiedAt) {
    await issueOtp(user.id, email);
    redirect(`/verify-email?email=${encodeURIComponent(email)}`);
  }
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const m = await db.membership.findFirst({ where: { userId: user.id, status: "active", org: { status: "active" } }, orderBy: { createdAt: "asc" } });
  await createSession(user.id, m?.orgId ?? null);
  const next = str(fd, "next");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : m ? "/dashboard" : "/onboarding");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function forgotPasswordAction(fd: FormData) {
  const email = str(fd, "email").toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  let dev = "";
  if (user) {
    const t = token();
    await db.passwordReset.create({ data: { token: t, userId: user.id, expiresAt: new Date(Date.now() + 60 * 60_000) } });
    await sendMail(email, "Reset your Plant Metrics password", `Reset your password: ${appUrl(`/reset-password?token=${t}`)}`);
    if (showDevSecrets) dev = `&dev=${t}`;
  }
  redirect(`/forgot-password?ok=${encodeURIComponent("If that email has an account, a reset link is on its way.")}${dev}`);
}

export async function resetPasswordAction(fd: FormData) {
  const t = str(fd, "token");
  const back = `/reset-password?token=${t}`;
  const reset = await db.passwordReset.findUnique({ where: { token: t } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) fail(back, "This reset link is invalid or has expired.");
  const pw = str(fd, "password");
  if (!validPassword(pw)) fail(back, PASSWORD_RULE);
  await db.$transaction([
    db.user.update({ where: { id: reset.userId }, data: { passwordHash: await hashPassword(pw) } }),
    db.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
  ]);
  redirect(`/login?ok=${encodeURIComponent("Password updated. Please sign in.")}`);
}

export async function acceptInviteAction(fd: FormData) {
  const t = str(fd, "token");
  const back = `/accept-invite?token=${t}`;
  const inv = await db.invite.findUnique({ where: { token: t }, include: { role: true } });
  if (!inv || inv.status !== "pending" || inv.expiresAt < new Date()) fail(back, "This invitation is no longer valid.");
  let user = await db.user.findUnique({ where: { email: inv.email } });
  if (!user) {
    const pw = str(fd, "password");
    if (!str(fd, "first_name")) fail(back, "Please enter your name.");
    if (!validPassword(pw)) fail(back, PASSWORD_RULE);
    user = await db.user.create({
      data: { email: inv.email, passwordHash: await hashPassword(pw), firstName: str(fd, "first_name"), lastName: str(fd, "last_name"), emailVerifiedAt: new Date() },
    });
  }
  const scope = inv.role.isSupplier ? { scopeType: "partner", scopeIds: [], partnerId: inv.partnerId } : { scopeType: inv.scopeType, scopeIds: inv.scopeIds, partnerId: null };
  await db.$transaction(async (tx) => {
    await tx.membership.upsert({
      where: { userId_orgId: { userId: user.id, orgId: inv.orgId } },
      create: { userId: user.id, orgId: inv.orgId, roleId: inv.roleId, ...scope },
      update: { roleId: inv.roleId, status: "active", ...scope },
    });
    await tx.invite.update({ where: { id: inv.id }, data: { status: "accepted" } });
    await audit({ orgId: inv.orgId, userId: user.id }, { action: "joined", entityType: "user", entityId: user.id, entityLabel: user.email, after: { role: inv.role.name, ...scope } }, tx);
  });
  await createSession(user.id, inv.orgId);
  redirect("/dashboard");
}

export async function createOrgAction(fd: FormData) {
  const { user } = await requireUser();
  const name = str(fd, "org_name");
  const siteName = str(fd, "site_name");
  if (!name || !siteName) fail("/onboarding", "Enter your organisation and first plant.");
  const org = await db.$transaction(async (tx) => {
    const { org, adminRole } = await setupOrganisation(tx, { name, siteName });
    await tx.membership.create({ data: { userId: user.id, orgId: org.id, roleId: adminRole.id } });
    await audit({ orgId: org.id, userId: user.id }, { action: "created", entityType: "organisation", entityId: org.id, entityLabel: name, after: { name } }, tx);
    return org;
  });
  await createSession(user.id, org.id);
  redirect("/dashboard");
}

export async function switchOrgAction(fd: FormData) {
  const { user } = await requireUser();
  const oid = str(fd, "org_id");
  const m = await db.membership.findUnique({ where: { userId_orgId: { userId: user.id, orgId: oid } } });
  if (!m || m.status !== "active") fail("/dashboard", "You do not have access to that organisation.");
  await createSession(user.id, oid);
  redirect("/dashboard");
}
