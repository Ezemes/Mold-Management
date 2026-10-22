import { openApiSpec } from "@/lib/openapi";
import { appUrl } from "@/lib/mail";

export const dynamic = "force-dynamic";

/** Public: the API description, for code generators and API tools. */
export function GET() {
  return Response.json(openApiSpec(appUrl("").replace(/\/$/, "")), { headers: { "Access-Control-Allow-Origin": "*" } });
}
