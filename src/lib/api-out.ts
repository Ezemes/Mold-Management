import "server-only";
import type { Asset, AssetType, Cavity, Meter, Partner, Site, Transfer, TransferItem, WorkOrder, WorkOrderLabor, WorkOrderPart, Handover } from "@prisma/client";
import { iso } from "./api";
import { woCost } from "./maintenance";

type AssetFull = Asset & { assetType: AssetType; site: Site; custodianPartner: Partner | null; ownerPartner: Partner | null; meters: Meter[]; cavities: Pick<Cavity, "status">[] };

export const assetInclude = { assetType: true, site: true, custodianPartner: true, ownerPartner: true, meters: true, cavities: { select: { status: true } } } as const;

const num = (v: unknown) => (v == null ? null : Number(v));

export function assetOut(a: AssetFull) {
  const shots = a.meters.find((m) => m.kind === "shots");
  const activeCavities = a.cavities.length ? a.cavities.filter((c) => c.status === "active").length : a.designCavities;
  return {
    id: a.id,
    number: a.number,
    name: a.name,
    type: { key: a.assetType.key, name: a.assetType.name, kind: a.assetType.kind },
    status: a.status,
    site: { code: a.site.code, name: a.site.name },
    location_detail: a.locationDetail,
    custodian: a.custodianPartner ? { partner_id: a.custodianPartner.id, name: a.custodianPartner.name } : { partner_id: null, name: "organisation" },
    owner: a.ownerPartner ? { partner_id: a.ownerPartner.id, name: a.ownerPartner.name } : { partner_id: null, name: "organisation" },
    program: a.program,
    tool_number: a.toolNumber,
    design: {
      cavities: a.designCavities, active_cavities: activeCavities, cycle_time_s: a.designCycleTimeS, shot_weight_g: a.shotWeightG, clamp_tonnage_t: a.clampTonnageT,
      width_mm: a.widthMm, height_mm: a.heightMm, mold_height_mm: a.stackHeightMm, weight_kg: a.weightKg, hot_runner_zones: a.hotRunnerZones,
    },
    life: {
      lifetime_shots: shots?.lifetimeTotal ?? null,
      last_reading_at: iso(shots?.lastReadingAt),
      warranty_shots: a.warrantyShots,
      end_of_life_shots: a.endOfLifeShots,
      life_used_pct: shots && a.endOfLifeShots ? Math.round((shots.lifetimeTotal / a.endOfLifeShots) * 1000) / 10 : null,
      refurbishments_done: a.refurbsDone,
      last_refurbishment_at: iso(a.lastRefurbDate),
    },
    condition_score: a.conditionScore,
    requalification_required: a.requalificationReason || null,
    capital_value: num(a.capitalValue),
    cost_centre: a.costCentre,
    custom_fields: a.customValues,
    updated_at: a.updatedAt.toISOString(),
  };
}

export function siteOut(s: Site & { partner: Partner | null }) {
  return { id: s.id, code: s.code, name: s.name, kind: s.kind, company: s.partner ? { partner_id: s.partner.id, name: s.partner.name } : null, city: s.city, state: s.state, timezone: s.timezone, active: s.active };
}

export function partnerOut(p: Partner) {
  return { id: p.id, name: p.name, kind: p.kind, gstin: p.gstin, status: p.status };
}

type TransferFull = Transfer & { fromSite: Site; toSite: Site; fromPartner: Partner | null; toPartner: Partner | null; items: (TransferItem & { asset: Pick<Asset, "number">; handovers: Handover[] })[] };
export const transferInclude = { fromSite: true, toSite: true, fromPartner: true, toPartner: true, items: { include: { asset: { select: { number: true } }, handovers: true } } } as const;

export function transferOut(t: TransferFull) {
  const party = (s: Site, p: Partner | null) => ({ site: s.name, site_code: s.code, company: p?.name ?? null });
  return {
    id: t.id, number: t.number, status: t.status, reason: t.reason,
    from: party(t.fromSite, t.fromPartner), to: party(t.toSite, t.toPartner),
    needed_by: iso(t.neededBy), requested_at: iso(t.requestedAt), approved_at: iso(t.approvedAt), shipped_at: iso(t.shippedAt), received_at: iso(t.receivedAt), completed_at: iso(t.completedAt),
    carrier: t.carrier, tracking_number: t.trackingNumber, vehicle_number: t.vehicleNumber, eway_bill_number: t.ewayBillNumber, eta: iso(t.eta),
    items: t.items.map((i) => {
      const h = (dir: string) => i.handovers.find((x) => x.direction === dir);
      const hv = (x?: Handover) => (x ? { at: x.at.toISOString(), shot_reading: x.shotReading, lifetime_shots: x.lifetimeShots, condition_ok: x.conditionOk } : null);
      return { asset: i.asset.number, status: i.status, outbound: hv(h("outbound")), inbound: hv(h("inbound")) };
    }),
    updated_at: t.updatedAt.toISOString(),
  };
}

type WoFull = WorkOrder & { asset: Pick<Asset, "number">; labor: WorkOrderLabor[]; parts: WorkOrderPart[]; assignedPartner: Partner | null };
export const workOrderInclude = { asset: { select: { number: true } }, labor: true, parts: true, assignedPartner: true } as const;

export function workOrderOut(w: WoFull) {
  const c = woCost(w);
  return {
    id: w.id, number: w.number, asset: w.asset.number, type: w.type, title: w.title, description: w.description, status: w.status, priority: w.priority, source: w.source,
    assigned_company: w.assignedPartner?.name ?? null, due_date: iso(w.dueDate), due_at_shots: w.dueAtShots,
    started_at: iso(w.startedAt), completed_at: iso(w.completedAt), signed_by: w.signedByName || null, shots_at_completion: w.shotsAtCompletion,
    checklist_pass_pct: w.passPct, root_cause: w.rootCause, resolution: w.resolution,
    cost: { labor: c.labor, parts: c.parts, external: c.external, total: c.total, hours: c.hours },
    updated_at: w.updatedAt.toISOString(),
  };
}
