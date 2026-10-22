/** Transfer rules (spec §4.1, decision D3). Pure functions, unit-tested. */

export const TRANSFER_STATUS = {
  draft: "Draft",
  requested: "Awaiting approval",
  approved: "Approved, ready to ship",
  in_transit: "In transit",
  disputed: "Received with dispute",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
} as const;
export type TransferStatus = keyof typeof TRANSFER_STATUS;

export const TRANSFER_REASONS = {
  production_move: "Production move",
  refurbishment: "Refurbishment / repair",
  storage: "Storage",
  end_of_program: "End of program",
  return_to_owner: "Return to owner",
  other: "Other",
} as const;

export const OPEN_TRANSFER_STATUSES: TransferStatus[] = ["draft", "requested", "approved", "in_transit", "disputed"];

export type TransferEvent = "submit" | "approve" | "reject" | "ship" | "receive" | "resolve" | "cancel";

const TRANSITIONS: Record<TransferEvent, { from: TransferStatus[] }> = {
  submit: { from: ["draft"] },
  approve: { from: ["requested"] },
  reject: { from: ["requested"] },
  ship: { from: ["approved"] },
  receive: { from: ["in_transit"] },
  resolve: { from: ["disputed"] },
  cancel: { from: ["draft", "requested", "approved"] },
};

export function canTransition(status: string, event: TransferEvent) {
  return TRANSITIONS[event].from.includes(status as TransferStatus);
}

/** Does a transfer need approval under the organisation policy? Cross-company = custodian changes. */
export function needsApproval(policy: string, fromPartnerId: string | null, toPartnerId: string | null) {
  if (policy === "never") return false;
  if (policy === "always") return true;
  return fromPartnerId !== toPartnerId;
}

export type HandoverCheck = { key: string; label: string; ok: boolean; note: string };

export const HANDOVER_CHECKLIST: { key: string; label: string }[] = [
  { key: "parting_line", label: "Parting line free of damage" },
  { key: "cavities", label: "Cavities and cores clean, no visible damage" },
  { key: "cooling", label: "Cooling circuits drained and plugged" },
  { key: "hot_runner", label: "Hot-runner connectors and wiring intact" },
  { key: "ejectors", label: "Ejector system operates freely" },
  { key: "rust", label: "Rust preventive applied" },
  { key: "safety_strap", label: "Mold safety strap fitted" },
  { key: "accessories", label: "All listed accessories present" },
];

export type DisputeFinding = { kind: "shot_mismatch" | "condition" | "missing_accessories"; detail: string };

/**
 * Compare outbound and inbound handovers. Molds should not run in transit:
 * the inbound reading must not be lower than outbound, nor higher by more than the tolerance.
 */
export function reconcileHandovers(
  out: { lifetimeShots: number | null; conditionOk: boolean; checklist: HandoverCheck[]; accessories: string },
  inb: { lifetimeShots: number | null; conditionOk: boolean; checklist: HandoverCheck[]; accessoriesComplete: boolean },
  tolerance: number,
): DisputeFinding[] {
  const findings: DisputeFinding[] = [];
  if (out.lifetimeShots != null && inb.lifetimeShots != null) {
    const gap = inb.lifetimeShots - out.lifetimeShots;
    if (gap < 0) findings.push({ kind: "shot_mismatch", detail: `Received counter is ${Math.abs(gap).toLocaleString("en-IN")} shots LOWER than at dispatch.` });
    else if (gap > tolerance) findings.push({ kind: "shot_mismatch", detail: `${gap.toLocaleString("en-IN")} shots between dispatch and receipt (tolerance ${tolerance.toLocaleString("en-IN")}). The mold may have run in transit.` });
  }
  const newlyFailed = inb.checklist.filter((c) => !c.ok && out.checklist.find((o) => o.key === c.key)?.ok !== false);
  if (!inb.conditionOk || newlyFailed.length) {
    findings.push({ kind: "condition", detail: newlyFailed.length ? `Condition issues on receipt: ${newlyFailed.map((c) => c.label + (c.note ? ` (${c.note})` : "")).join("; ")}` : "Receiver reported the mold not in acceptable condition." });
  }
  if (!inb.accessoriesComplete && out.accessories.trim()) findings.push({ kind: "missing_accessories", detail: `Accessories listed at dispatch not all received: ${out.accessories}` });
  return findings;
}
