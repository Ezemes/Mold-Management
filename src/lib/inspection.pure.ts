/**
 * Mold inspections: the health rating scale ("Mold Health Rating"), the inspection templates
 * (Injection and Injection Blow spreadsheets, and the Workflow-based Inspection for extrusion blow),
 * the standard questions and the rules for a complete, valid assessment. Pure functions, unit-tested.
 */

/** 5 = best, as in the Mold Health Rating document. Always shown with the word, never as a bare number. */
export const RATINGS = {
  5: { word: "Excellent", desc: "Like new condition. No issues related to the tool or quality.", color: "green" },
  4: { word: "Good", desc: "No major issues with the steel, good quality, clean condition, no work required.", color: "green" },
  3: { word: "Fair", desc: "Normal wear, no damage, minor quality issues that can be addressed by the supplier.", color: "amber" },
  2: { word: "Poor", desc: "Defects that require mold repair, replacement of components, damage, neglect, or any reason that requires funding to repair or replace components or even the entire tool.", color: "red" },
  1: { word: "Unacceptable", desc: "Unacceptable steel or quality, or jeopardises the life of the tool. Requires immediate repair, refurbishment or replacement. The tool should not run until corrected.", color: "red" },
} as const;
export type Rating = keyof typeof RATINGS;
export const NA_DESC = "Component is not applicable to the asset.";
export const ratingWord = (r: number | null | undefined) => (r == null ? "N/A" : (RATINGS[r as Rating]?.word ?? String(r)));

export type Component = { key: string; label: string; weight: number; checks: string[] };
export type TemplateDef = { name: string; processes: string[]; isDefault: boolean; components: Component[] };

const keyOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "component";
const simple = (labels: string[]): Component[] => labels.map((label) => ({ key: keyOf(label), label, weight: 1, checks: [] }));

/** Defaults from the documents you supplied. Each organisation can edit its own copies. */
export const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    name: "Injection",
    processes: ["Injection", "Precision Injection"],
    isDefault: true,
    components: simple([
      "Baffles/Bubblers", "Cams/Slides", "Cartridge Heaters", "Cavities", "Collapsible Core", "Cores", "Ejector Pins", "Ejector Sleeves", "Ejector/Retainer Plates",
      "Flippers", "Gate Inserts/Well", "Hot Sprue", "Latch Locks", "Leader Pins/Bushings", "Lifters", "Manifolds", "Mold Base Plates", "Mold Plate Interlocks",
      "Quality Part Attributes", "Stripper Rings", "Thermal Pins", "Unscrewing Component", "Vents", "Water Channels", "Wear Plates",
    ]),
  },
  {
    name: "Injection Blow",
    processes: ["Injection Blow", "Injection Stretch Blow"],
    isDefault: false,
    components: simple([
      "Backup Bushing", "Blow Cavities", "Blow Neck Rings", "Bottom Plugs", "Cam & Ball", "Core Rods", "Die Sets (Blow)", "Die Sets (Parison)", "End Plates", "Face Bars",
      "Gate Inserts", "Nozzle Seats", "Parison Cavities", "Parison Manifold", "Parison Neck Rings", "Pick-Off", "Quality Part Attributes", "Vents (Blow)",
      "Water Channels (Parison)", "Water Channels (Blow)",
    ]),
  },
  {
    // Workflow-based Inspection (an initial proposal in the source document; review with your team).
    name: "Extrusion Blow",
    processes: ["Extrusion Blow", "Stretch Blow"],
    isDefault: false,
    components: [
      { label: "Blow Pins", checks: ["Check for bend", "Check the sharpness of the cutting sleeve", "Check dimension and surface of the blow pin tip", "Cooling effectiveness"] },
      { label: "Cavity", checks: ["Check parting line – bulging, dents", "Check for damage in cavities – crack, dents, scratches", "Check cavity texture/polish", "Check for wear and tear, rust, pit marks", "Check profile – curve or straightness", "Check for blocked air vents", "Steel – grade, quality"] },
      { label: "Cavity Bottom Base", checks: ["Identification mark visible", "Brand logo visible", "Recycle or other logo visible", "Check parting line – bulging, dents", "Check for damage in cavities – crack, dents, scratches", "Check cavity texture/polish", "Check for wear and tear, rust, pit marks", "Check profile – curve or straightness", "Check for blocked air vents", "Steel – grade, quality"] },
      { label: "Cycle count tracked", checks: ["Installed in mold", "Checked as per production system"] },
      { label: "Guide pin / Bushings", checks: ["Check for scratches, dents or damage", "Check for oil groove", "Check for clearance between parts", "Check for rust, pit marks", "Check if parts are getting heated during production", "Check for lubrication"] },
      { label: "Neck Region / Insert Rings", checks: ["Check for any damage, crack", "Check for any wear and tear", "Check finishing and profile"] },
      { label: "Pinch off", checks: ["Check for sharpness", "Check for damages, dents", "Check for the gap when the mold is closed"] },
      { label: "Quality Part Attributes", checks: ["Check aesthetics of the last-shot sample", "Check critical dimension reports", "Check for process-related damage in samples – shrinkage, bend, burn marks", "Check colour against the standard sample"] },
      { label: "Striker Plate", checks: ["Check for any damage, crack", "Check for any wear and tear", "Check finishing and thread profile"] },
      { label: "Tool Cleanliness", checks: ["Check mold cleanliness", "Check for rust marks, pit marks", "Check for damage on mold surfaces and housing"] },
      { label: "Trim / Detab", checks: ["Check for sharpness", "Check for damages, dents", "Check for the gap when the station is closed", "Check alignment – bend, misfit"] },
      { label: "Vents", checks: ["Check for clean air vents", "Check vent depth, size and number, and whether more vents are needed"] },
      { label: "Water Channel", checks: ["Check for leakage", "Check flow in all cavities", "Check flow in the bottom base", "Check for blockages in the mold housing", "Check hole sizes", "Check cooling time and whether it can be improved", "Check for broken connectors", "Check O-ring grooves"] },
    ].map((c) => ({ key: keyOf(c.label), label: c.label, weight: 1, checks: c.checks })),
  },
];

/** The template for an asset: one listing its process, else the default, else null. */
export function pickTemplate<T extends { processes: string[]; isDefault: boolean; active: boolean }>(templates: T[], process: string): T | null {
  const live = templates.filter((t) => t.active);
  const p = process.trim().toLowerCase();
  return (p && live.find((t) => t.processes.some((x) => x.toLowerCase() === p))) || live.find((t) => t.isDefault) || null;
}

/** Editor format: "Label | weight" per component; indented "- check" lines below it are its key points. */
export function parseComponents(src: string): { components: Component[]; errors: string[] } {
  const components: Component[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  src.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith("-")) {
      const last = components[components.length - 1];
      if (!last) errors.push(`Line ${i + 1}: a check must follow a component.`);
      else if (line.slice(1).trim()) last.checks.push(line.slice(1).trim().slice(0, 200));
      return;
    }
    const [label, w] = line.split("|").map((x) => x.trim());
    const weight = w === undefined || w === "" ? 1 : Number(w);
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100) { errors.push(`Line ${i + 1}: weight must be a number above 0.`); return; }
    let key = keyOf(label);
    for (let n = 2; seen.has(key); n++) key = `${keyOf(label)}_${n}`;
    seen.add(key);
    components.push({ key, label: label.slice(0, 100), weight, checks: [] });
  });
  if (!components.length) errors.push("Add at least one component.");
  if (components.length > 60) errors.push("At most 60 components per template.");
  return { components, errors };
}

export function componentLines(cs: Component[]) {
  return cs.map((c) => [`${c.label}${c.weight !== 1 ? ` | ${c.weight}` : ""}`, ...c.checks.map((k) => `  - ${k}`)].join("\n")).join("\n");
}

// ─── Questions (from the inspection templates) ──────────────────────────────

export const SPARE_PARTS_STATUS = { Okay: "Okay", Need: "Need", TBD: "TBD" } as const;
export const QUESTIONS = {
  qualityIssues: "Are there any quality issues with parts molded from this tool?",
  operationalIssues: "Are there any operational issues that prevent the tool from running uninterrupted in a free and easy state?",
  sparePartsNeeded: "Does this asset require any spare parts to prevent extensive downtime in the future?",
  supplyRisk: "Is the tool a supply risk that needs repair or replacement?",
  overallCondition: "Describe the overall condition of the tool at the time of assessment.",
  recommendations: "Any recommendations or additional information the tool owner should be aware of?",
} as const;

export type ComponentResult = Component & { score: number | null; note: string; checkResults: { text: string; ok: boolean | null }[]; photos: number };
export type Answers = {
  mode: "bench" | "machine";
  dynamic: { cavitiesRunning: number | null; cavitiesTotal: number | null; lastRunDate: string | null; totalShots: number | null; annualVolume: number | null };
  qualityIssues: boolean | null; qualityNote: string;
  operationalIssues: boolean | null; operationalNote: string;
  spareParts: keyof typeof SPARE_PARTS_STATUS | null; sparePartsNote: string;
  supplyRisk: boolean | null; supplyRiskNote: string;
  overallCondition: string;
  recommendations: string;
  video: boolean;
};

/**
 * Everything an assessment must contain before it can be submitted, as messages to show the user:
 * a rating (or N/A) for every component; every key point answered; a comment and a photo for any
 * check answered NO; a comment for any Poor or Unacceptable rating; the questions answered, with a
 * comment where the answer flags a problem.
 */
export function validateAssessment(results: ComponentResult[], a: Answers): string[] {
  const e: string[] = [];
  for (const c of results) {
    if (c.score === undefined || (c.score !== null && !(c.score >= 1 && c.score <= 5))) e.push(`${c.label}: choose a rating or N/A.`);
    if (c.checkResults.some((k) => k.ok === null)) e.push(`${c.label}: answer every check YES or NO.`);
    const no = c.checkResults.filter((k) => k.ok === false);
    if (no.length && !c.note.trim()) e.push(`${c.label}: a comment is required when a check is NO.`);
    if (no.length && c.photos < 1) e.push(`${c.label}: add a photo for the NO answer${no.length > 1 ? "s" : ""}.`);
    if (c.score != null && c.score <= 2 && !c.note.trim()) e.push(`${c.label}: explain the ${ratingWord(c.score)} rating and how to correct it.`);
  }
  if (a.qualityIssues === null) e.push("Answer whether there are quality issues.");
  if (a.qualityIssues && !a.qualityNote.trim()) e.push("Describe the quality issues.");
  if (a.operationalIssues === null) e.push("Answer whether there are operational issues.");
  if (a.operationalIssues && !a.operationalNote.trim()) e.push("Describe the operational issues.");
  if (!a.spareParts) e.push("Choose the spare parts status.");
  if (a.spareParts === "Need" && !a.sparePartsNote.trim()) e.push("List the spare parts needed.");
  if (a.supplyRisk === null) e.push("Answer whether the tool is a supply risk.");
  if (a.supplyRisk && !a.supplyRiskNote.trim()) e.push("Explain the supply risk and the repair or replacement needed.");
  if (!a.overallCondition.trim()) e.push("Describe the overall condition of the tool.");
  const d = a.dynamic;
  if (d.cavitiesRunning != null && d.cavitiesTotal != null && d.cavitiesRunning > d.cavitiesTotal) e.push("Cavities running can't exceed the total.");
  return e;
}

/** What an approved assessment means for the tool. */
export function assessmentOutcome(results: ComponentResult[], a: Pick<Answers, "qualityIssues" | "operationalIssues" | "spareParts" | "supplyRisk">, score: number, threshold: number) {
  const unacceptable = results.filter((c) => c.score === 1).map((c) => c.label);
  const poor = results.filter((c) => c.score === 2).map((c) => c.label);
  const reasons = [
    ...(unacceptable.length ? [`Unacceptable: ${unacceptable.join(", ")}`] : []),
    ...(poor.length ? [`Poor: ${poor.join(", ")}`] : []),
    ...(score < threshold ? [`Weighted score ${score.toFixed(2)} below ${threshold}`] : []),
    ...(a.qualityIssues ? ["Quality issues reported"] : []),
    ...(a.operationalIssues ? ["Operational issues reported"] : []),
    ...(a.supplyRisk ? ["Supply risk reported"] : []),
  ];
  return { stopTool: unacceptable.length > 0, workOrderRequired: reasons.length > 0, reasons, sparePartsNeeded: a.spareParts === "Need" };
}
