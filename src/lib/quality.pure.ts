/** Condition evaluation and qualification rules (spec §4.5, §4.6). Pure functions, unit-tested. */

export type Criterion = { key: string; label: string; weight: number };
export type Score = Criterion & { score: number | null; note?: string };

export const DEFAULT_MOLD_CRITERIA: Criterion[] = [
  { key: "parting_line", label: "Parting line", weight: 3 },
  { key: "cavity_surfaces", label: "Cavity and core surfaces", weight: 3 },
  { key: "vents", label: "Vents", weight: 2 },
  { key: "cooling", label: "Cooling circuits", weight: 2 },
  { key: "ejectors", label: "Ejector pins and plates", weight: 2 },
  { key: "hot_runner", label: "Hot runner", weight: 2 },
  { key: "slides", label: "Slides and lifters", weight: 1 },
  { key: "guiding", label: "Guide pillars and bushes", weight: 1 },
];

export const SCORE_LABELS: Record<number, string> = { 1: "1 · Unusable", 2: "2 · Poor", 3: "3 · Fair", 4: "4 · Good", 5: "5 · As new" };

/** "Label | weight" per line; weight defaults to 1. Keys come from labels and stay unique. */
export function parseCriteria(src: string): Criterion[] {
  const seen = new Set<string>();
  return src
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((line) => {
      const [labelRaw, weightRaw] = line.split("|").map((x) => x.trim());
      const w = Number(weightRaw);
      let key = labelRaw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "criterion";
      for (let i = 2; seen.has(key); i++) key = `${key.replace(/_\d+$/, "")}_${i}`;
      seen.add(key);
      return { key, label: labelRaw.slice(0, 100), weight: Number.isFinite(w) && w > 0 ? Math.min(w, 100) : 1 };
    });
}

export function criteriaLines(c: Criterion[]) {
  return c.map((x) => `${x.label} | ${x.weight}`).join("\n");
}

/** Weighted mean of the scored criteria (1–5); unscored (N/A) criteria are left out. */
export function weightedScore(scores: Score[]): number | null {
  const s = scores.filter((x) => x.score != null && x.score >= 1 && x.score <= 5);
  const w = s.reduce((t, x) => t + x.weight, 0);
  if (!w) return null;
  return Math.round((s.reduce((t, x) => t + x.score! * x.weight, 0) / w) * 100) / 100;
}

export function scoreBand(score: number | null, threshold: number): "good" | "watch" | "poor" | "none" {
  if (score == null) return "none";
  if (score < threshold) return "poor";
  if (score < threshold + 1) return "watch";
  return "good";
}

// ─── Qualification ──────────────────────────────────────────────────────────

export const QUAL_STAGES = ["IQ", "OQ", "PQ"] as const;
export type QualStage = (typeof QUAL_STAGES)[number];
export const STAGE_NAMES: Record<QualStage, string> = { IQ: "Installation (IQ)", OQ: "Operational (OQ)", PQ: "Performance (PQ)" };
export const QUAL_STATUS = { in_progress: "In progress", passed: "Passed", failed: "Failed", cancelled: "Cancelled" } as const;

type StageRow = { stage: string; status: string };

/** The stage that can be worked on now: the first one not passed, if every earlier stage passed. */
export function currentStage(stages: StageRow[]): QualStage | null {
  for (const s of QUAL_STAGES) {
    const row = stages.find((x) => x.stage === s);
    if (!row || row.status === "failed") return null;
    if (row.status !== "passed") return s;
  }
  return null;
}

/** Overall result after a stage changes: failed if any stage failed, passed once PQ passes. */
export function qualificationOutcome(stages: StageRow[]): "in_progress" | "passed" | "failed" {
  if (stages.some((s) => s.status === "failed")) return "failed";
  if (QUAL_STAGES.every((s) => stages.find((x) => x.stage === s)?.status === "passed")) return "passed";
  return "in_progress";
}
