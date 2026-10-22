/**
 * Demo data for Plant Metrics Mold Management.
 *   npm run db:seed            (idempotent: skips if the demo organisation exists)
 * All demo users have the password Demo@12345.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { setupOrganisation } from "../src/lib/org-setup";
import { parseTaskLines } from "../src/lib/maintenance.pure";

const db = new PrismaClient();
const PASSWORD = "Demo@12345";
const day = 86_400_000;

async function main() {
  if (await db.organisation.findFirst({ where: { name: "Sharma Polymers Pvt Ltd" } })) {
    console.log("Demo organisation already exists; nothing to do.");
    return;
  }
  const hash = await bcrypt.hash(PASSWORD, 10);

  await db.$transaction(async (tx) => {
    const { org } = await setupOrganisation(tx, { name: "Sharma Polymers Pvt Ltd", siteName: "Pune Plant 1", city: "Pune", state: "Maharashtra" });
    const roles = Object.fromEntries((await tx.role.findMany({ where: { orgId: org.id } })).map((r) => [r.key!, r]));
    const types = Object.fromEntries((await tx.assetType.findMany({ where: { orgId: org.id } })).map((t) => [t.key, t]));

    const auto = await tx.division.create({ data: { orgId: org.id, name: "Automotive", code: "AUTO" } });
    const pune = await tx.site.findFirstOrThrow({ where: { orgId: org.id } });
    await tx.site.update({ where: { id: pune.id }, data: { code: "PUN1", divisionId: auto.id, address: "Plot 42, MIDC Bhosari", postalCode: "411026", latitude: 18.6298, longitude: 73.8474 } });
    const chennai = await tx.site.create({ data: { orgId: org.id, name: "Chennai Plant", code: "CHE1", kind: "plant", city: "Sriperumbudur", state: "Tamil Nadu", postalCode: "602105" } });
    const store = await tx.site.create({ data: { orgId: org.id, name: "Pune Tool Store", code: "PUN-TS", kind: "warehouse", divisionId: auto.id, city: "Pune", state: "Maharashtra" } });

    const brightway = await tx.partner.create({ data: { orgId: org.id, name: "Brightway Plastics", kind: "molder", gstin: "27AABCB1234C1Z5", contactName: "Rahul Deshmukh", contactEmail: "rahul@brightway.example", contactPhone: "+91 98220 00000" } });
    const precision = await tx.partner.create({ data: { orgId: org.id, name: "Precision Toolings", kind: "toolmaker", gstin: "33AAFCP5678D1Z2", contactName: "S. Kumar" } });
    const chakan = await tx.site.create({ data: { orgId: org.id, partnerId: brightway.id, name: "Brightway Chakan", code: "BW-CHK", kind: "supplier", city: "Chakan", state: "Maharashtra" } });
    await tx.site.create({ data: { orgId: org.id, partnerId: precision.id, name: "Precision Hosur", code: "PT-HSR", kind: "toolmaker", city: "Hosur", state: "Tamil Nadu" } });

    const user = (email: string, firstName: string, lastName: string) => tx.user.create({ data: { email, passwordHash: hash, firstName, lastName, emailVerifiedAt: new Date() } });
    const admin = await user("admin@sharma.example", "Anita", "Sharma");
    const tooling = await user("tooling@sharma.example", "Vikram", "Joshi");
    const tech = await user("tech@sharma.example", "Suresh", "Patil");
    const supplier = await user("supplier@brightway.example", "Rahul", "Deshmukh");
    await tx.membership.createMany({
      data: [
        { userId: admin.id, orgId: org.id, roleId: roles.org_admin.id },
        { userId: tooling.id, orgId: org.id, roleId: roles.tooling_manager.id },
        { userId: tech.id, orgId: org.id, roleId: roles.technician.id, scopeType: "sites", scopeIds: [pune.id, store.id] },
        { userId: supplier.id, orgId: org.id, roleId: roles.supplier_admin.id, scopeType: "partner", partnerId: brightway.id },
      ],
    });

    await tx.fieldDef.createMany({
      data: [
        { assetTypeId: types.mold.id, key: "steel_grade", label: "Steel grade", type: "picklist", options: ["P20", "H13", "S136", "NAK80"], section: "Design" },
        { assetTypeId: types.mold.id, key: "gate_type", label: "Gate type", type: "picklist", options: ["Pin", "Edge", "Submarine", "Hot tip", "Valve gate"], section: "Design" },
        { assetTypeId: types.mold.id, key: "parts_per_hour", label: "Parts per hour (design)", type: "formula", formula: "round(active_cavities * 3600 / design_cycle_time_s, 0)", unit: "parts/h", section: "Design", sortOrder: 10 },
      ],
    });

    const molds: [string, string, string, number, number, number, number, number, string, number][] = [
      // number, name, siteId, cavities, cycle s, warranty, eol, shots now, steel, days since last reading
      ["M-0001", "Door trim LH", pune.id, 2, 45, 500_000, 1_000_000, 412_000, "P20", 3],
      ["M-0002", "Door trim RH", pune.id, 2, 45, 500_000, 1_000_000, 405_500, "P20", 3],
      ["M-0003", "AC vent louvre", pune.id, 8, 22, 800_000, 1_500_000, 1_390_000, "H13", 40],
      ["M-0004", "Glovebox latch", chakan.id, 4, 18, 1_000_000, 2_000_000, 980_000, "S136", 6],
      ["M-0005", "Bumper clip", chakan.id, 16, 14, 1_500_000, 3_000_000, 2_850_000, "H13", 2],
      ["M-0006", "Fuse box cover", chennai.id, 4, 30, 600_000, 1_200_000, 150_000, "NAK80", 12],
      ["M-0007", "Seat lever knob", store.id, 8, 20, 700_000, 1_400_000, 0, "P20", -1],
    ];
    for (const [number, name, siteId, cav, cycle, warranty, eol, shots, steel, ago] of molds) {
      const site = [pune, chennai, store, chakan].find((s) => s.id === siteId)!;
      const a = await tx.asset.create({
        data: {
          orgId: org.id, assetTypeId: types.mold.id, number, name, qrToken: randomBytes(12).toString("hex"), siteId, custodianPartnerId: site.partnerId ?? null,
          toolmakerPartnerId: precision.id, program: "Tata Nexon facelift", designCavities: cav, designCycleTimeS: cycle, shotWeightG: cav * 18, material: "PP-TD20",
          clampTonnageT: cav >= 8 ? 350 : 220, warrantyShots: warranty, shotsBetweenRefurbs: Math.round(eol / 3), refurbsAllowed: 2, endOfLifeShots: eol,
          buildDate: new Date("2023-04-01"), capitalValue: cav * 350_000, costCentre: "CC-AUTO-01",
          customValues: { steel_grade: steel, gate_type: "Submarine" } as Prisma.InputJsonValue,
        },
      });
      await tx.cavity.createMany({ data: Array.from({ length: cav }, (_, i) => ({ assetId: a.id, identifier: String(i + 1), ...(number === "M-0005" && i === 15 ? { status: "blocked", blockedReason: "Short shot, awaiting insert" } : {}) })) });
      await tx.assetProduct.create({ data: { assetId: a.id, partNumber: `TN-${number.slice(2)}-A`, partName: name, customer: "Tata Motors" } });
      const meter = await tx.meter.create({ data: { assetId: a.id } });
      if (ago >= 0) {
        // two readings: baseline 30 days before the latest one
        const latest = new Date(Date.now() - ago * day);
        const base = Math.max(0, shots - 30 * 24 * 3600 / cycle * 0.4);
        await tx.meterReading.createMany({
          data: [
            { meterId: meter.id, rawValue: Math.round(base), lifetime: Math.round(base), delta: 0, readAt: new Date(latest.getTime() - 30 * day), source: "import", enteredById: tooling.id },
            { meterId: meter.id, rawValue: shots, lifetime: shots, delta: shots - Math.round(base), readAt: latest, source: "manual", enteredById: tech.id },
          ],
        });
        await tx.meter.update({ where: { id: meter.id }, data: { lastRawValue: shots, lifetimeTotal: shots, lastReadingAt: latest } });
      }
      await tx.auditEvent.create({ data: { orgId: org.id, userId: admin.id, action: "created", entityType: "asset", entityId: a.id, entityLabel: `${number} ${name}`, reason: "Demo data" } });
    }
    // ── Maintenance: templates, plans in each state, one triggered and one completed work order
    const pm = await tx.maintenanceTemplate.create({
      data: {
        orgId: org.id, name: "50k shot PM", kind: "preventive", estimatedHours: 4, description: "Routine service every 50,000 shots",
        tasks: parseTaskLines("Clean parting line and vents\nCheck ejector pins and return springs\nGrease guide pillars and bushes\nmeasure: Cooling flow, circuit A [l/min] (8-12)\nphoto: Core side after cleaning\n* Check hot runner zone temperatures") as unknown as Prisma.InputJsonValue,
      },
    });
    const insp = await tx.maintenanceTemplate.create({
      data: { orgId: org.id, name: "Half-yearly inspection", kind: "inspection", estimatedHours: 2, tasks: parseTaskLines("Visual check for cracks and corrosion\nCheck water lines and fittings for leaks\nVerify QR tag is legible") as unknown as Prisma.InputJsonValue },
    });
    await tx.maintenanceTemplate.create({
      data: { orgId: org.id, name: "Refurbishment", kind: "refurbishment", estimatedHours: 40, tasks: parseTaskLines("Strip and inspect all inserts\nReplace worn ejector pins\nRe-polish cavity surfaces\nmeasure: Parting line flatness [mm] (0-0.02)\nTrial run and first-article approval") as unknown as Prisma.InputJsonValue },
    });
    const byNum = Object.fromEntries((await tx.asset.findMany({ where: { orgId: org.id }, include: { meters: true } })).map((a) => [a.number, a]));
    const plan = (n: string, templateId: string, triggerType: string, interval: number, baselineShots: number, daysAgo: number) =>
      tx.maintenancePlan.create({ data: { orgId: org.id, assetId: byNum[n].id, templateId, triggerType, interval, baselineShots, baselineDate: new Date(Date.now() - daysAgo * day) } });
    await plan("M-0001", pm.id, "shots", 50_000, 370_000, 60); // 84% — on track
    await plan("M-0002", pm.id, "shots", 50_000, 360_000, 60); // 91% — due soon
    const due = await plan("M-0004", pm.id, "shots", 50_000, 920_000, 90); // 120% — due
    await plan("M-0006", insp.id, "days", 180, 0, 150); // 83% of the calendar interval
    const pmTasks = (pm.tasks as unknown as object[]).map((t) => ({ ...t, result: null, value: null, note: "" }));
    await tx.workOrder.create({
      data: {
        orgId: org.id, number: "WO-00001", assetId: byNum["M-0004"].id, type: "preventive", title: "50k shot PM", planId: due.id, templateId: pm.id, source: "trigger", sourceId: due.id,
        dueDate: new Date(Date.now() + 2 * day), dueAtShots: 970_000, assignedPartnerId: brightway.id, checklist: pmTasks as unknown as Prisma.InputJsonValue,
      },
    });
    const done = await tx.workOrder.create({
      data: {
        orgId: org.id, number: "WO-00002", assetId: byNum["M-0003"].id, type: "corrective", title: "Flash on louvre blade 3", status: "completed", priority: "high",
        createdAt: new Date(Date.now() - 20 * day), startedAt: new Date(Date.now() - 19 * day), completedAt: new Date(Date.now() - 18 * day), dueDate: new Date(Date.now() - 17 * day),
        rootCause: "Worn parting line at cavity 3", resolution: "Parting line re-ground and polished", assignedUserId: tech.id, completedById: tech.id, signedByName: "Suresh Patil", signedAt: new Date(Date.now() - 18 * day),
        shotsAtCompletion: 1_350_000, externalCost: 12_000, createdById: tooling.id,
      },
    });
    await tx.workOrderLabor.create({ data: { workOrderId: done.id, userId: tech.id, workerName: "Suresh Patil", hours: 6, rate: 450 } });
    await tx.workOrderPart.create({ data: { workOrderId: done.id, partNumber: "EJ-6x150", description: "Ejector pin 6 × 150", quantity: 4, unitCost: 380 } });

    const press = await tx.asset.create({ data: { orgId: org.id, assetTypeId: types.press.id, number: "P-0001", name: "Engel 350t #1", qrToken: randomBytes(12).toString("hex"), siteId: pune.id, clampTonnageT: 350, hotRunnerZones: 12 } });
    void press;
  });
  console.log(`Demo data created. Password for all users: ${PASSWORD}
  admin@sharma.example        Org Admin
  tooling@sharma.example      Tooling Manager
  tech@sharma.example         Technician (Pune Plant 1 + Pune Tool Store only)
  supplier@brightway.example  Supplier Admin (Brightway Plastics)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
