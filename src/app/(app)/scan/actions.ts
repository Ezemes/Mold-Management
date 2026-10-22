"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { str } from "@/lib/forms";

export async function findByNumberAction(fd: FormData) {
  const ctx = await requireOrg(["assets", "view"]);
  const n = str(fd, "number");
  const a = await db.asset.findFirst({ where: { AND: [assetScope(ctx), { number: { equals: n, mode: "insensitive" } }] } });
  redirect(a ? `/assets/${a.id}?tab=counter` : `/scan?error=${encodeURIComponent(`No asset ${n} in your scope.`)}`);
}
