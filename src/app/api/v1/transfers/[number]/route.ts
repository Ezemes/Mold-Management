import { db } from "@/lib/db";
import { ApiError, apiRoute, keyTransferScope } from "@/lib/api";
import { transferInclude, transferOut } from "@/lib/api-out";

export const GET = apiRoute<{ number: string }>("transfers:read", async (_req, ctx, { number }) => {
  const t = await db.transfer.findFirst({ where: { AND: [keyTransferScope(ctx), { number: decodeURIComponent(number).toUpperCase() }] }, include: transferInclude });
  if (!t) throw new ApiError(404, "not_found", "Transfer not found.");
  return { data: transferOut(t) };
});
