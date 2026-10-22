import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { getFile } from "@/lib/storage";

/** Download a document version, only if its asset is in the user's scope. */
export async function GET(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const ctx = await requireOrg(["documents", "view"]);
  const v = await db.documentVersion.findFirst({ where: { id: versionId, document: { asset: assetScope(ctx) } } });
  if (!v) return new Response("Not found", { status: 404 });
  const bytes = await getFile(v.storageKey);
  const inline = /^(image\/|application\/pdf)/.test(v.mimeType);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": v.mimeType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(v.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
