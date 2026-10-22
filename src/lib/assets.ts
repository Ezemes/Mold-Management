import type { Asset, FieldDef } from "@prisma/client";
import { evalFormula } from "./formula";

export const ASSET_STATUS = {
  active: "Active",
  in_transfer: "In transfer",
  in_maintenance: "In maintenance",
  refurbishing: "Refurbishing",
  quarantined: "Quarantined",
  retired: "Retired",
  scrapped: "Scrapped",
} as const;

export const COMPONENT_ROLES = ["insert", "core", "cavity block", "slide", "lifter", "hot runner", "ejector system", "other"] as const;

export const PARTNER_KINDS = { molder: "Molder", toolmaker: "Toolmaker", warehouse: "Warehouse", supplier: "Supplier", customer: "Customer" } as const;
export const SITE_KINDS = { plant: "Plant", warehouse: "Warehouse", toolmaker: "Toolmaker", supplier: "Supplier site" } as const;
export const DOC_CATEGORIES = {
  drawing: "Drawing (2D/3D)",
  trial_report: "Mold trial report",
  certificate: "Certificate",
  qualification: "Qualification record",
  photo: "Photo",
  manual: "Manual",
  other: "Other",
} as const;

export type Kind = "mold" | "press" | "equipment";
export type StdField = {
  key: keyof Asset & string;
  /** Snake-case name used in formulas and CSV headers. */
  var: string;
  label: string;
  type: "text" | "int" | "float" | "date" | "money";
  unit?: "mm" | "kg" | "g" | "t" | "s" | "shots";
  section: "Design" | "Life" | "Finance";
  kinds: Kind[];
};

/** Standard typed fields. Custom fields live in Asset.customValues and FieldDef. */
export const STD_FIELDS: StdField[] = [
  { key: "toolNumber", var: "tool_number", label: "Tool number", type: "text", section: "Design", kinds: ["mold"] },
  { key: "designCavities", var: "design_cavities", label: "Design cavities", type: "int", section: "Design", kinds: ["mold"] },
  { key: "designCycleTimeS", var: "design_cycle_time_s", label: "Design cycle time", type: "float", unit: "s", section: "Design", kinds: ["mold"] },
  { key: "shotWeightG", var: "shot_weight_g", label: "Shot weight", type: "float", unit: "g", section: "Design", kinds: ["mold"] },
  { key: "material", var: "material", label: "Material", type: "text", section: "Design", kinds: ["mold"] },
  { key: "clampTonnageT", var: "clamp_tonnage_t", label: "Clamp tonnage", type: "float", unit: "t", section: "Design", kinds: ["mold", "press"] },
  { key: "lengthMm", var: "length_mm", label: "Length", type: "float", unit: "mm", section: "Design", kinds: ["mold", "press", "equipment"] },
  { key: "widthMm", var: "width_mm", label: "Width", type: "float", unit: "mm", section: "Design", kinds: ["mold", "press", "equipment"] },
  { key: "heightMm", var: "height_mm", label: "Height", type: "float", unit: "mm", section: "Design", kinds: ["mold", "press", "equipment"] },
  { key: "weightKg", var: "weight_kg", label: "Weight", type: "float", unit: "kg", section: "Design", kinds: ["mold", "press", "equipment"] },
  { key: "hotRunnerZones", var: "hot_runner_zones", label: "Hot-runner zones", type: "int", section: "Design", kinds: ["mold", "press"] },
  { key: "coolingCircuits", var: "cooling_circuits", label: "Cooling circuits", type: "int", section: "Design", kinds: ["mold"] },
  { key: "buildDate", var: "build_date", label: "Build date", type: "date", section: "Life", kinds: ["mold", "press", "equipment"] },
  { key: "warrantyShots", var: "warranty_shots", label: "Warranty shots", type: "int", unit: "shots", section: "Life", kinds: ["mold"] },
  { key: "shotsBetweenRefurbs", var: "shots_between_refurbs", label: "Shots between refurbishments", type: "int", unit: "shots", section: "Life", kinds: ["mold"] },
  { key: "refurbsAllowed", var: "refurbs_allowed", label: "Refurbishments allowed", type: "int", section: "Life", kinds: ["mold"] },
  { key: "refurbsDone", var: "refurbs_done", label: "Refurbishments done", type: "int", section: "Life", kinds: ["mold"] },
  { key: "endOfLifeShots", var: "end_of_life_shots", label: "End-of-life shots", type: "int", unit: "shots", section: "Life", kinds: ["mold"] },
  { key: "capitalisationDate", var: "capitalisation_date", label: "Capitalisation date", type: "date", section: "Finance", kinds: ["mold", "press", "equipment"] },
  { key: "capitalValue", var: "capital_value", label: "Capital value", type: "money", section: "Finance", kinds: ["mold", "press", "equipment"] },
  { key: "costCentre", var: "cost_centre", label: "Cost centre", type: "text", section: "Finance", kinds: ["mold", "press", "equipment"] },
];

export function stdFieldsFor(kind: string) {
  return STD_FIELDS.filter((f) => f.kinds.includes(kind as Kind));
}

export type Features = { components: boolean; cavities: boolean; products: boolean; meters: boolean; documents: boolean };
export const FEATURE_LABELS: Record<keyof Features, string> = {
  components: "Components (child parts)",
  cavities: "Cavities",
  products: "Products made",
  meters: "Shot counter",
  documents: "Documents",
};
export function features(raw: unknown): Features {
  const f = (raw ?? {}) as Partial<Features>;
  return { components: !!f.components, cavities: !!f.cavities, products: !!f.products, meters: !!f.meters, documents: f.documents !== false };
}

export const DEFAULT_TYPES: { key: string; name: string; kind: Kind; numberPrefix: string; description: string; features: Features }[] = [
  { key: "mold", name: "Injection mold", kind: "mold", numberPrefix: "M-", description: "Injection molds and their components.", features: { components: true, cavities: true, products: true, meters: true, documents: true } },
  { key: "press", name: "Molding press", kind: "press", numberPrefix: "P-", description: "Injection molding machines.", features: { components: false, cavities: false, products: false, meters: false, documents: true } },
  { key: "equipment", name: "General equipment", kind: "equipment", numberPrefix: "E-", description: "Auxiliary and plant equipment.", features: { components: true, cavities: false, products: false, meters: false, documents: true } },
];

/** Variables available to formula fields: standard numeric fields, live counters and numeric custom fields. */
export function formulaVars(asset: Asset, live: { activeCavities: number | null; lifetimeShots: number | null }, defs: FieldDef[]) {
  const vars: Record<string, number | null> = {};
  for (const f of STD_FIELDS) {
    const v = asset[f.key];
    vars[f.var] = typeof v === "number" ? v : v != null && typeof v === "object" && "toNumber" in v ? (v as { toNumber(): number }).toNumber() : null;
  }
  vars.active_cavities = live.activeCavities;
  vars.lifetime_shots = live.lifetimeShots;
  const custom = (asset.customValues ?? {}) as Record<string, unknown>;
  for (const d of defs) if (d.type === "number") vars[d.key] = typeof custom[d.key] === "number" ? (custom[d.key] as number) : null;
  // Formulas may reference earlier formulas (sorted by sortOrder).
  for (const d of [...defs].sort((a, b) => a.sortOrder - b.sortOrder)) if (d.type === "formula") vars[d.key] = evalFormula(d.formula, vars);
  return vars;
}

export const FORMULA_HELP = "Use + − × ÷ (as + - * /), parentheses, min(), max(), round(x, digits). Variables: standard fields (e.g. design_cavities, design_cycle_time_s), active_cavities, lifetime_shots and numeric custom fields by key.";

export function slugKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "field";
}
