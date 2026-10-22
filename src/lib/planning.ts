import "server-only";
import { db } from "./db";
import { assetScope, type Ctx } from "./auth";
import { lifeForecast, monthKey, shotsPerMonth, type CapacityMold } from "./planning.pure";

export * from "./planning.pure";

const DAY = 86_400_000;

/** Every running mold in scope with its shot rate (trailing 90 days) and life forecast. */
export async function fleetForecast(ctx: Ctx, now = new Date()) {
  const molds = await db.asset.findMany({
    where: { AND: [assetScope(ctx), { assetType: { kind: "mold" }, parentId: null, status: { notIn: ["retired", "scrapped"] } }] },
    include: { meters: true, site: true, custodianPartner: true, products: true, cavities: { select: { status: true } }, _count: { select: { pressesFor: { where: { status: "approved" } } } } },
    orderBy: { number: "asc" },
  });
  const meterIds = molds.flatMap((m) => m.meters.filter((x) => x.kind === "shots").map((x) => x.id));
  const start = new Date(now.getTime() - 90 * DAY);
  const [recent, baseline] = await Promise.all([
    db.meterReading.findMany({ where: { meterId: { in: meterIds }, readAt: { gte: start } }, select: { meterId: true, readAt: true, lifetime: true } }),
    db.meterReading.findMany({ where: { meterId: { in: meterIds }, readAt: { lt: start } }, orderBy: [{ meterId: "asc" }, { readAt: "desc" }], distinct: ["meterId"], select: { meterId: true, readAt: true, lifetime: true } }),
  ]);
  return molds.map((a) => {
    const meter = a.meters.find((x) => x.kind === "shots");
    const lifetime = meter?.lifetimeTotal ?? 0;
    const rate = meter ? shotsPerMonth([...baseline, ...recent].filter((r) => r.meterId === meter.id), now) : null;
    const activeCavities = a.cavities.length ? a.cavities.filter((c) => c.status === "active").length : (a.designCavities ?? 0);
    return { asset: a, lifetime, rate, activeCavities, approvedPresses: a._count.pressesFor, forecast: lifeForecast({ ...a, lifetime, rate }, now) };
  });
}

export type FleetRow = Awaited<ReturnType<typeof fleetForecast>>[number];

/** The fleet as capacity-planning inputs: refurbishment months and the first month past end of life. */
export function toCapacityMolds(rows: FleetRow[]): CapacityMold[] {
  return rows
    .filter((r) => r.asset.products.length)
    .map((r) => ({
      id: r.asset.id,
      number: r.asset.number,
      cycleS: r.asset.designCycleTimeS,
      activeCavities: r.activeCavities,
      products: r.asset.products.map((p) => ({ partNumber: p.partNumber, cavities: p.cavitiesUsed })),
      refurbMonths: r.forecast.refurbs.filter((x) => x.date).map((x) => monthKey(x.date!)),
      eolMonth: r.forecast.eol?.date ? nextMonth(monthKey(r.forecast.eol.date)) : null,
    }));
}

function nextMonth(key: string) {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(Date.UTC(y, m, 1)));
}

export function parseMonth(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}-${m[2].padStart(2, "0")}` : null;
  m = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) return +m[1] >= 1 && +m[1] <= 12 ? `${m[2]}-${m[1].padStart(2, "0")}` : null;
  return null;
}

export const monthStart = (key: string) => new Date(`${key}-01T00:00:00Z`);
