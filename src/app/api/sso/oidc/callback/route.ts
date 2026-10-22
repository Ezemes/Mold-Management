import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { appUrl } from "@/lib/mail";
import { finishOidc, SsoError, STATE_COOKIE } from "@/lib/sso";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const r = await finishOidc(new URL(req.url).searchParams, (await cookies()).get(STATE_COOKIE)?.value);
    await createSession(r.userId, r.orgId);
    (await cookies()).delete({ name: STATE_COOKIE, path: "/api/sso" });
    return NextResponse.redirect(appUrl(r.returnTo), 303);
  } catch (e) {
    if (!(e instanceof SsoError)) console.error("oidc callback failed", e);
    return NextResponse.redirect(appUrl(`/login/sso?error=${encodeURIComponent(e instanceof SsoError ? e.message : "Sign-in failed. Try again.")}`), 303);
  }
}
