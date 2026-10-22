import type { Meter } from "@prisma/client";

export type ReadingInput = {
  rawValue: number;
  readAt: Date;
  source: "manual" | "import" | "handover" | "api";
  isReset?: boolean;
  resetReason?: string;
  note?: string;
  enteredById?: string | null;
  /** Accept a jump larger than the mold could physically produce. */
  confirmHigh?: boolean;
  /** Design cycle time, used for the plausibility check. */
  cycleTimeS?: number | null;
};

export class ReadingError extends Error {
  constructor(message: string, readonly code: "invalid" | "backwards" | "backdated" | "future" | "implausible") {
    super(message);
  }
}

/**
 * Validate and compute a reading against the meter's current state (pure, no I/O).
 * Lifetime total = raw counter + offset. A counter reset adds the last raw value to the
 * offset so the lifetime total keeps increasing.
 */
export function computeReading(meter: Pick<Meter, "offset" | "lastRawValue" | "lastReadingAt" | "lifetimeTotal">, r: ReadingInput, now = new Date()) {
  if (!Number.isInteger(r.rawValue) || r.rawValue < 0) throw new ReadingError("Enter a whole number of shots (0 or more).", "invalid");
  if (Number.isNaN(r.readAt.getTime())) throw new ReadingError("Enter a valid date and time.", "invalid");
  if (r.readAt.getTime() > now.getTime() + 5 * 60_000) throw new ReadingError("The reading date is in the future.", "future");
  if (meter.lastReadingAt && r.readAt < meter.lastReadingAt) {
    throw new ReadingError(`A newer reading already exists (${meter.lastReadingAt.toISOString().slice(0, 16).replace("T", " ")} UTC). Readings must be entered in time order.`, "backdated");
  }

  let offset = meter.offset;
  let delta: number;
  if (meter.lastRawValue == null) {
    delta = 0; // first reading establishes the baseline
  } else if (r.isReset) {
    if (!r.resetReason?.trim()) throw new ReadingError("Give a reason for the counter reset or replacement.", "invalid");
    offset = meter.offset + meter.lastRawValue;
    delta = r.rawValue;
  } else if (r.rawValue < meter.lastRawValue) {
    throw new ReadingError(`This reading (${r.rawValue}) is lower than the last one (${meter.lastRawValue}). If the counter was reset or replaced, mark it as a reset and give a reason.`, "backwards");
  } else {
    delta = r.rawValue - meter.lastRawValue;
  }

  // A replacement counter need not start at zero, so the time-based bound only applies to continuing counters.
  if (!r.confirmHigh && !r.isReset && delta > 0 && meter.lastReadingAt && r.cycleTimeS && r.cycleTimeS > 0) {
    const elapsedS = (r.readAt.getTime() - meter.lastReadingAt.getTime()) / 1000;
    const maxPossible = Math.ceil((elapsedS / r.cycleTimeS) * 1.1) + 10;
    if (delta > maxPossible) {
      throw new ReadingError(`${delta.toLocaleString("en-IN")} shots since the last reading is more than this mold can run in that time (about ${maxPossible.toLocaleString("en-IN")} at its design cycle time). Check the value, or confirm it is correct.`, "implausible");
    }
  }

  return { offset, delta, lifetime: r.rawValue + offset };
}

export function isReadingOverdue(lastReadingAt: Date | null, overdueDays: number, now = new Date()) {
  if (!lastReadingAt) return true;
  return now.getTime() - lastReadingAt.getTime() > overdueDays * 86_400_000;
}
