/** Maintenance rules (spec §4.4). Pure functions, unit-tested. */

export const WO_TYPES = { preventive: "Preventive", corrective: "Corrective", refurbishment: "Refurbishment", inspection: "Inspection", modification: "Modification" } as const;
export const WO_STATUS = { open: "Open", in_progress: "In progress", on_hold: "On hold", completed: "Completed", cancelled: "Cancelled" } as const;
export const WO_PRIORITY = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" } as const;
export const TEMPLATE_KINDS = { preventive: "Preventive maintenance", inspection: "Inspection", refurbishment: "Refurbishment" } as const;
export const OPEN_WO: string[] = ["open", "in_progress", "on_hold"];
/** Maps work-order statuses onto the shared badge colours. */
export const WO_BADGE: Record<string, string> = { open: "pending", in_progress: "validated", on_hold: "overdue", completed: "active", cancelled: "archived" };
export const PRIORITY_COLOR = { urgent: "red", high: "amber", medium: "blue", low: "gray" } as const;

export type TaskDef = { id: string; text: string; type: "check" | "measure" | "photo"; unit?: string; min?: number | null; max?: number | null; required: boolean };
export type TaskResult = TaskDef & { result: "pass" | "fail" | "na" | null; value?: number | null; note?: string };

/** Parse a template's tasks from a textarea, one per line: "text", "measure: text [unit] (min-max)", "photo: text", leading "*" = optional. */
export function parseTaskLines(src: string): TaskDef[] {
  return src
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 100)
    .map((line, i) => {
      let text = line;
      let required = true;
      if (text.startsWith("*")) { required = false; text = text.slice(1).trim(); }
      let type: TaskDef["type"] = "check";
      const m = text.match(/^(measure|photo|check)\s*:\s*(.+)$/i);
      if (m) { type = m[1].toLowerCase() as TaskDef["type"]; text = m[2]; }
      let unit: string | undefined;
      let min: number | null = null;
      let max: number | null = null;
      if (type === "measure") {
        const r = text.match(/\((-?[\d.]+)\s*[-–]\s*(-?[\d.]+)\)\s*$/);
        if (r) { min = Number(r[1]); max = Number(r[2]); text = text.slice(0, r.index).trim(); }
        const u = text.match(/\[([^\]]{1,12})\]\s*$/);
        if (u) { unit = u[1]; text = text.slice(0, u.index).trim(); }
      }
      return { id: `t${i + 1}`, text: text.slice(0, 300), type, unit, min, max, required };
    });
}

export function taskLines(tasks: TaskDef[]) {
  return tasks
    .map((t) => `${t.required ? "" : "* "}${t.type === "check" ? "" : `${t.type}: `}${t.text}${t.unit ? ` [${t.unit}]` : ""}${t.min != null && t.max != null ? ` (${t.min}-${t.max})` : ""}`)
    .join("\n");
}

/** A measurement outside its range fails even if marked pass. */
export function evaluateTask(t: TaskResult): TaskResult["result"] {
  if (t.type === "measure" && t.value != null && Number.isFinite(t.value)) {
    if ((t.min != null && t.value < t.min) || (t.max != null && t.value > t.max)) return "fail";
    return t.result === "na" ? "na" : "pass";
  }
  return t.result;
}

export function checklistSummary(tasks: TaskResult[]) {
  const evaluated = tasks.map((t) => ({ ...t, result: evaluateTask(t) }));
  const missing = evaluated.filter((t) => t.required && (t.result == null || (t.type === "measure" && t.result !== "na" && (t.value == null || !Number.isFinite(t.value)))));
  const scored = evaluated.filter((t) => t.result === "pass" || t.result === "fail");
  const passPct = scored.length ? (scored.filter((t) => t.result === "pass").length / scored.length) * 100 : null;
  return { tasks: evaluated, missing, failed: evaluated.filter((t) => t.result === "fail"), passPct };
}

export type PlanState = { status: "ok" | "due_soon" | "due"; progress: number; remaining: number; unit: "shots" | "days"; dueAtShots: number | null; dueDate: Date | null };

/** Where a plan stands: progress through its interval since the baseline. */
export function planState(p: { triggerType: string; interval: number; leadPct: number; baselineShots: number; baselineDate: Date }, lifetimeShots: number | null, now = new Date()): PlanState {
  if (p.triggerType === "shots") {
    const used = Math.max(0, (lifetimeShots ?? p.baselineShots) - p.baselineShots);
    const progress = p.interval > 0 ? used / p.interval : 0;
    return { status: progress >= 1 ? "due" : progress * 100 >= p.leadPct ? "due_soon" : "ok", progress, remaining: Math.max(0, p.interval - used), unit: "shots", dueAtShots: p.baselineShots + p.interval, dueDate: null };
  }
  const days = (now.getTime() - p.baselineDate.getTime()) / 86_400_000;
  const progress = p.interval > 0 ? days / p.interval : 0;
  const dueDate = new Date(p.baselineDate.getTime() + p.interval * 86_400_000);
  return { status: progress >= 1 ? "due" : progress * 100 >= p.leadPct ? "due_soon" : "ok", progress, remaining: Math.max(0, Math.ceil(p.interval - days)), unit: "days", dueAtShots: null, dueDate };
}

export type WoForMetrics = { type: string; status: string; createdAt: Date; completedAt: Date | null; dueDate: Date | null; assetId: string };

/** PM compliance, MTTR and MTBF over a period (spec §4.4 compliance views). */
export function maintenanceMetrics(wos: WoForMetrics[], periodStart: Date, periodEnd: Date, assetCount: number) {
  const inPeriod = (d: Date | null) => !!d && d >= periodStart && d <= periodEnd;
  const pm = wos.filter((w) => (w.type === "preventive" || w.type === "inspection") && w.dueDate && inPeriod(w.dueDate) && w.status !== "cancelled");
  const onTime = pm.filter((w) => w.completedAt && w.dueDate && w.completedAt.getTime() <= w.dueDate.getTime() + 86_399_000).length;
  const corrective = wos.filter((w) => w.type === "corrective" && w.status === "completed" && inPeriod(w.completedAt));
  const mttrHours = corrective.length ? corrective.reduce((s, w) => s + (w.completedAt!.getTime() - w.createdAt.getTime()), 0) / corrective.length / 3_600_000 : null;
  const failures = wos.filter((w) => w.type === "corrective" && inPeriod(w.createdAt)).length;
  const periodDays = (periodEnd.getTime() - periodStart.getTime()) / 86_400_000;
  const mtbfDays = failures ? (periodDays * Math.max(1, assetCount)) / failures : null;
  const overdue = wos.filter((w) => OPEN_WO.includes(w.status) && w.dueDate && w.dueDate < periodEnd).length;
  return { pmDue: pm.length, pmOnTime: onTime, pmCompliancePct: pm.length ? (onTime / pm.length) * 100 : null, mttrHours, mtbfDays, failures, overdue };
}
