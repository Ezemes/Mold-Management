import "server-only";
import type { Meter, Prisma } from "@prisma/client";
import { computeReading, type ReadingInput } from "./meters.pure";

export { computeReading, isReadingOverdue, ReadingError, type ReadingInput } from "./meters.pure";

export async function recordReading(tx: Prisma.TransactionClient, meter: Meter, r: ReadingInput) {
  const c = computeReading(meter, r);
  const reading = await tx.meterReading.create({
    data: {
      meterId: meter.id,
      rawValue: r.rawValue,
      lifetime: c.lifetime,
      delta: c.delta,
      readAt: r.readAt,
      source: r.source,
      isReset: !!r.isReset && meter.lastRawValue != null,
      resetReason: r.resetReason ?? "",
      note: r.note ?? "",
      enteredById: r.enteredById ?? null,
    },
  });
  await tx.meter.update({ where: { id: meter.id }, data: { offset: c.offset, lastRawValue: r.rawValue, lifetimeTotal: c.lifetime, lastReadingAt: r.readAt } });
  return reading;
}
