import { runDaily } from "@/lib/daily";

export const dynamic = "force-dynamic";

/** Call once a day from the host's scheduler: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/daily`. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runDaily();
  return Response.json({ ok: true, ...result });
}
