import "server-only";
import type { Meter } from "@prisma/client";
import { db } from "./db";
import { assetScope, type Ctx } from "./auth";
import { features, formulaVars } from "./assets";
import { isReadingOverdue } from "./meters";
import { calculate, calcVars, inputFromAsset } from "./calc.pure";

export async function loadPassport(ctx: Ctx, id: string) {
  const a = await db.asset.findFirst({
    where: { AND: [assetScope(ctx), { id }] },
    include: {
      assetType: { include: { fields: { where: { archived: false }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } } },
      site: { include: { partner: true, division: true } },
      ownerPartner: true,
      custodianPartner: true,
      toolmakerPartner: true,
      parent: true,
      components: { where: { deletedAt: null }, orderBy: { number: "asc" } },
      cavities: { orderBy: { createdAt: "asc" } },
      products: { orderBy: { partNumber: "asc" } },
      meters: true,
      documents: { orderBy: { updatedAt: "desc" }, include: { versions: { orderBy: { version: "desc" }, include: { uploadedBy: true } } } },
    },
  });
  if (!a) return null;
  return { asset: a, live: liveStats(a, ctx.org.readingOverdueDays, ctx.org) };
}

type LiveInput = Parameters<typeof formulaVars>[0] & {
  status: string;
  cavities: { status: string }[];
  meters: Meter[];
  assetType: { kind: string; features: unknown; fields: Parameters<typeof formulaVars>[2] };
  site?: Parameters<typeof inputFromAsset>[0]["site"];
};

/** Live counters, the built-in calculated fields (when the site is loaded) and custom formula values. */
export function liveStats(a: LiveInput, overdueDays: number, org?: { cavityCosts: unknown }) {
  const calc = a.site && org ? calculate(inputFromAsset({ ...a, site: a.site }, org)) : null;
  const f = features(a.assetType.features);
  const shots = a.meters.find((m) => m.kind === "shots") ?? null;
  const activeCavities = a.cavities.length ? a.cavities.filter((c) => c.status === "active").length : a.designCavities ?? null;
  const lifetimeShots = shots ? shots.lifetimeTotal : null;
  const pct = (limit: number | null | undefined) => (lifetimeShots != null && limit ? Math.min(999, (lifetimeShots / limit) * 100) : null);
  const vars = formulaVars(a, { activeCavities, lifetimeShots }, a.assetType.fields, calc ? calcVars(calc) : {});
  const tracksReadings = f.meters && a.status === "active";
  return {
    features: f,
    shots,
    activeCavities,
    blockedCavities: a.cavities.filter((c) => c.status === "blocked").length,
    lifetimeShots,
    warrantyPct: pct(a.warrantyShots),
    endOfLifePct: pct(a.endOfLifeShots),
    shotsToEndOfLife: lifetimeShots != null && a.endOfLifeShots ? Math.max(0, a.endOfLifeShots - lifetimeShots) : null,
    readingOverdue: tracksReadings && shots ? isReadingOverdue(shots.lastReadingAt, overdueDays) : false,
    calc,
    formulas: Object.fromEntries(a.assetType.fields.filter((d) => d.type === "formula").map((d) => [d.key, vars[d.key] ?? null])),
  };
}

/** Custodian display name: a partner, or the organisation itself. */
export function custodianName(a: { custodianPartner: { name: string } | null }, orgName: string) {
  return a.custodianPartner?.name ?? orgName;
}
