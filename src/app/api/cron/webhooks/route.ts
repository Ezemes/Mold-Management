import { dispatchDue } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

/** Retry due webhook deliveries. Call every minute: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/webhooks`. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ ok: true, ...(await dispatchDue(200)) });
}
