import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { transferScope } from "@/lib/transfers";
import { workOrderScope } from "@/lib/work-orders";
import { getFile } from "@/lib/storage";

/** Download a handover, work-order or evaluation attachment, only if its parent is in the user's scope. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const a = await db.attachment.findFirst({ where: { id, orgId: ctx.org.id } });
  if (!a) return new Response("Not found", { status: 404 });
  const visible =
    a.ownerType === "handover"
      ? ctx.can("transfers") && !!(await db.handover.findFirst({ where: { id: a.ownerId, item: { transfer: transferScope(ctx) } } }))
      : a.ownerType === "evaluation"
        ? ctx.can("quality") && !!(await db.conditionEvaluation.findFirst({ where: { id: a.ownerId, asset: assetScope(ctx) } }))
        : ctx.can("maintenance") && !!(await db.workOrder.findFirst({ where: { AND: [workOrderScope(ctx), { id: a.ownerId }] } }));
  if (!visible) return new Response("Not found", { status: 404 });
  const bytes = await getFile(a.storageKey);
  const inline = /^(image\/|video\/|application\/pdf)/.test(a.mimeType);
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": a.mimeType, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.filename)}`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox", "Cache-Control": "private, no-store" },
  });
}
