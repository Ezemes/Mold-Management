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
          toolmakerPartnerId: precision.id, program: "Tata Nexon facelift", designCavities: cav, designCycleTimeS: cycle, material: "PP-TD20",
          clampTonnageT: number === "M-0003" ? 450 : cav >= 8 ? 350 : 220, hotRunnerZones: number === "M-0003" ? 8 : null,
          // Sized so the compatibility finder has something to show (spec acceptance 4: M-0003 needs 450 t).
          shotWeightG: cav * 45, widthMm: 400 + cav * 15, heightMm: 450 + cav * 10, stackHeightMm: 350 + cav * 10, openingStrokeMm: 250, locatingRingMm: 125, sprueRadiusMm: 15.5, weightKg: 600 + cav * 100,
          warrantyShots: warranty, shotsBetweenRefurbs: Math.round(eol / 3), refurbsAllowed: 2, endOfLifeShots: eol,
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

    // ── Presses (spec §4.2) and one approved pair from a passed qualification
    const pressSpec = (number: string, name: string, siteId: string, t: number, tie: number, platen: number, hMin: number, hMax: number, opening: number, shot: number, zones: number, maxKg: number) =>
      tx.asset.create({
        data: {
          orgId: org.id, assetTypeId: types.press.id, number, name, qrToken: randomBytes(12).toString("hex"), siteId, custodianPartnerId: [chakan].find((x) => x.id === siteId)?.partnerId ?? null,
          clampTonnageT: t, tieBarHMm: tie, tieBarVMm: tie, platenWMm: platen, platenHMm: platen, minMoldHeightMm: hMin, maxMoldHeightMm: hMax, maxOpeningMm: opening, shotCapacityG: shot,
          locatingRingMm: 125, nozzleRadiusMm: 15, hotRunnerZones: zones, maxMoldWeightKg: maxKg,
        },
      });
    const p1 = await pressSpec("P-0001", "Engel 350t #1", pune.id, 350, 570, 820, 250, 550, 500, 400, 8, 2500);
    await pressSpec("P-0002", "JSW 450t", pune.id, 450, 660, 960, 300, 650, 600, 1000, 16, 4000);
    await pressSpec("P-0003", "Milacron 400t", chennai.id, 400, 620, 900, 250, 600, 550, 900, 12, 3000);
    await pressSpec("P-0004", "Haitian 250t", chakan.id, 250, 510, 750, 200, 500, 450, 400, 4, 1500);
    const m1 = await tx.asset.findFirstOrThrow({ where: { orgId: org.id, number: "M-0001" } });
    const q1 = await tx.qualification.create({
      data: {
        orgId: org.id, number: "Q-0001", assetId: m1.id, pressId: p1.id, siteId: pune.id, status: "passed", createdById: tooling.id, createdAt: new Date(Date.now() - 200 * day), closedAt: new Date(Date.now() - 180 * day),
        stages: { create: ["IQ", "OQ", "PQ"].map((stage, i) => ({ stage, status: "passed", ownerId: tooling.id, actualDate: new Date(Date.now() - (195 - i * 7) * day), result: stage === "PQ" ? "3 × 8 h runs at 45 s, Cpk 1.5 on critical dimensions" : `${stage} complete`, approvedById: admin.id, approvedAt: new Date(Date.now() - (195 - i * 7) * day) })) },
      },
    });
    await tx.moldPress.create({ data: { orgId: org.id, moldId: m1.id, pressId: p1.id, qualificationId: q1.id, approvedById: admin.id, approvedAt: new Date(Date.now() - 180 * day), notes: "Cycle 45 s" } });
    await tx.asset.update({ where: { id: m1.id }, data: { conditionScore: 4.2, conditionDate: new Date(Date.now() - 30 * day), nextEvaluationDate: new Date(Date.now() + 150 * day) } });
    await tx.conditionEvaluation.create({
      data: {
        orgId: org.id, assetId: m1.id, status: "approved", score: 4.2, evaluatedById: tech.id, evaluatedAt: new Date(Date.now() - 30 * day), decidedById: admin.id, decidedAt: new Date(Date.now() - 29 * day),
        scores: [["parting_line", "Parting line", 3, 4], ["cavity_surfaces", "Cavity and core surfaces", 3, 5], ["vents", "Vents", 2, 4], ["cooling", "Cooling circuits", 2, 4], ["ejectors", "Ejector pins and plates", 2, 4], ["hot_runner", "Hot runner", 2, null], ["slides", "Slides and lifters", 1, 4], ["guiding", "Guide pillars and bushes", 1, 4]].map(([key, label, weight, score]) => ({ key, label, weight, score, note: "" })) as Prisma.InputJsonValue,
      },
    });
    const m4 = await tx.asset.findFirstOrThrow({ where: { orgId: org.id, number: "M-0004" } });
    await tx.asset.update({ where: { id: m4.id }, data: { requalificationReason: "Moved to Brightway Chakan" } });

    // ── Spare parts with stock; the thermocouple is below its reorder point
    await tx.assetType.update({ where: { id: types.mold.id }, data: { budgetRules: { pmCostPerService: 12_000, partsPerCavity: 3_000, refurbCost: 250_000, replacementCost: 1_200_000 } } });
    const part = async (number: string, name: string, category: string, cost: number, siteId: string, qty: number, reorder: number, max: number, assets: string[]) => {
      const p = await tx.part.create({ data: { orgId: org.id, number, name, category, unitCost: cost, reorderPoint: reorder, maxQty: max, assets: { create: assets.map((n) => ({ assetId: byNum[n].id })) } } });
      await tx.stock.create({ data: { partId: p.id, siteId, quantity: qty, reorderPoint: reorder, maxQty: max, bin: "A-01" } });
      await tx.stockMove.create({ data: { orgId: org.id, partId: p.id, siteId, kind: "receipt", quantity: qty, balanceAfter: qty, unitCost: cost, reference: "Opening stock", userId: tooling.id } });
    };
    await part("EJ-6X150", "Ejector pin 6 × 150", "Ejectors", 380, pune.id, 40, 20, 100, ["M-0001", "M-0002"]);
    await part("HR-TC-J", "Hot-runner thermocouple, type J", "Hot runner", 1_450, pune.id, 3, 5, 20, ["M-0003"]);
    await part("OR-KIT-12", "Cooling O-ring kit", "Cooling", 650, chennai.id, 10, 4, 20, ["M-0006"]);

    // ── Demand for the next six months: M-0005 runs out of life, so its part goes short.
    const first = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    for (let i = 0; i < 6; i++) {
      const month = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1));
      await tx.productDemand.createMany({ data: [["TN-0001-A", 40_000], ["TN-0003-A", 400_000], ["TN-0005-A", 1_200_000]].map(([partNumber, quantity]) => ({ orgId: org.id, partNumber: partNumber as string, month, quantity: quantity as number })) });
    }
  }, { timeout: 60_000 });
  console.log(`Demo data created. Password for all users: ${PASSWORD}
  admin@sharma.example        Org Admin
  tooling@sharma.example      Tooling Manager
  tech@sharma.example         Technician (Pune Plant 1 + Pune Tool Store only)
  supplier@brightway.example  Supplier Admin (Brightway Plastics)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
