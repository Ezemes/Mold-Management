import "server-only";
import { db } from "./db";
import { notify, recipientsFor, emailPending } from "./notify";
import { evaluatePlans, OPEN_WO } from "./maintenance";

const DAY = 86_400_000;

/**
 * The daily job (spec §4.4–4.6): calendar and shot triggers, overdue readings, overdue work orders,
 * late transfers and condition evaluations due. Every alert is deduped, so running it twice in a day is harmless.
 */
export async function runDaily(now = new Date()) {
  const orgs = await db.organisation.findMany({ select: { id: true, readingOverdueDays: true } });
  const out = { orgs: orgs.length, raised: 0, warned: 0, readingAlerts: 0, woAlerts: 0, transferAlerts: 0, evaluationAlerts: 0 };
  const week = Math.floor(now.getTime() / (7 * DAY));
  for (const org of orgs) {
    const r = await evaluatePlans(org.id, undefined, now);
    out.raised += r.raised;
    out.warned += r.warned;

    // Readings overdue — one reminder per asset per week, to whoever holds the mold.
    const stale = await db.meter.findMany({
      where: { kind: "shots", asset: { orgId: org.id, deletedAt: null, status: "active" }, OR: [{ lastReadingAt: null }, { lastReadingAt: { lt: new Date(now.getTime() - org.readingOverdueDays * DAY) } }] },
      include: { asset: { select: { id: true, number: true, name: true, siteId: true, custodianPartnerId: true, createdAt: true } } },
      take: 2000,
    });
    for (const m of stale) {
      if (!m.lastReadingAt && m.asset.createdAt > new Date(now.getTime() - org.readingOverdueDays * DAY)) continue;
      const users = await recipientsFor(org.id, "readings", "create", { siteId: m.asset.siteId, partnerIds: [m.asset.custodianPartnerId] });
      out.readingAlerts += await notify(org.id, users, { kind: "reading_overdue", title: `Shot reading overdue: ${m.asset.number}`, body: `No counter reading for ${m.asset.name} in over ${org.readingOverdueDays} days.`, link: `/assets/${m.asset.id}?tab=counter`, dedupeKey: `reading-overdue:${m.asset.id}:${week}` });
    }

    // Work orders past their due date — once per order, to the assignee (or planners if unassigned).
    const late = await db.workOrder.findMany({ where: { orgId: org.id, status: { in: OPEN_WO }, dueDate: { lt: now } }, include: { asset: { select: { number: true, siteId: true } } } });
    for (const w of late) {
      const users = w.assignedUserId ? [w.assignedUserId] : await recipientsFor(org.id, "maintenance", "create", { siteId: w.asset.siteId, partnerIds: [w.assignedPartnerId] });
      out.woAlerts += await notify(org.id, users, { kind: "wo_overdue", title: `${w.number} is overdue`, body: `${w.title} on ${w.asset.number}.`, link: `/maintenance/work-orders/${w.id}`, dedupeKey: `wo-overdue:${w.id}` });
    }

    // Transfers in transit past their ETA — once per transfer, to the receiving side.
    const lateT = await db.transfer.findMany({ where: { orgId: org.id, status: "in_transit", eta: { lt: new Date(now.getTime() - DAY) } } });
    for (const t of lateT) {
      const users = await recipientsFor(org.id, "transfers", "edit", { siteId: t.toSiteId, partnerIds: [t.toPartnerId] });
      out.transferAlerts += await notify(org.id, users, { kind: "transfer_late", title: `Transfer ${t.number} is past its ETA`, body: "Confirm receipt if it has arrived, or follow up with the carrier.", link: `/transfers/${t.id}`, dedupeKey: `transfer-late:${t.id}` });
    }

    // Condition evaluations falling due — once per asset per due date.
    const evalDue = await db.asset.findMany({ where: { orgId: org.id, deletedAt: null, status: { notIn: ["retired", "scrapped"] }, nextEvaluationDate: { lte: now } }, select: { id: true, number: true, name: true, siteId: true, custodianPartnerId: true, nextEvaluationDate: true } });
    for (const a of evalDue) {
      const users = await recipientsFor(org.id, "quality", "create", { siteId: a.siteId, partnerIds: [a.custodianPartnerId] });
      out.evaluationAlerts += await notify(org.id, users, { kind: "evaluation_due", title: `Condition evaluation due: ${a.number}`, body: `${a.name} was due for evaluation on ${a.nextEvaluationDate!.toISOString().slice(0, 10)}.`, link: `/quality/evaluations/new?asset=${a.id}`, dedupeKey: `eval-due:${a.id}:${a.nextEvaluationDate!.toISOString().slice(0, 10)}` });
    }
  }
  await emailPending();
  return out;
}
