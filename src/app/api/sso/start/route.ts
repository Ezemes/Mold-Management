import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appUrl } from "@/lib/mail";
import { connectionForEmail, SsoError, startSignIn, STATE_COOKIE, stateCookieOptions } from "@/lib/sso";

export const dynamic = "force-dynamic";

const fail = (msg: string, email = "") => NextResponse.redirect(appUrl(`/login/sso?error=${encodeURIComponent(msg)}${email ? `&email=${encodeURIComponent(email)}` : ""}`), 303);

/** GET /api/sso/start?email=…&next=/path — find the organisation's connection by email domain and go to its IdP. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const email = (u.searchParams.get("email") ?? "").trim().toLowerCase();
  const c = u.searchParams.get("connection") ? await db.ssoConnection.findFirst({ where: { id: u.searchParams.get("connection")!, enabled: true } }) : await connectionForEmail(email);
  if (!c) return fail("Single sign-on isn't set up for that email domain. Sign in with your password instead.", email);
  try {
    const { url, state } = await startSignIn(c, u.searchParams.get("next") ?? "/dashboard");
    const res = NextResponse.redirect(url, 303);
    res.cookies.set(STATE_COOKIE, state, stateCookieOptions);
    return res;
  } catch (e) {
    if (e instanceof SsoError) return fail(e.message, email);
    console.error("sso start failed", e);
    return fail("Could not reach your identity provider. Try again or contact your administrator.", email);
  }
}
