import { db } from "@/lib/db";
import { samlFor } from "@/lib/sso";

export const dynamic = "force-dynamic";

/** Service-provider metadata for the IdP administrator (entity ID, ACS URL). */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("connection") ?? "";
  const c = await db.ssoConnection.findFirst({ where: { id, protocol: "saml" } });
  if (!c) return new Response("Not found", { status: 404 });
  return new Response(samlFor(c).generateServiceProviderMetadata(null), { headers: { "Content-Type": "application/samlmetadata+xml" } });
}
