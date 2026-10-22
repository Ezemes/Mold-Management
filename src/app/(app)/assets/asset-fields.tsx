import type { Asset, FieldDef } from "@prisma/client";
import { stdFieldsFor } from "@/lib/assets";
import { Field, Input, Select } from "@/components/ui";

const UNIT_LABEL: Record<string, string> = { mm: "mm", kg: "kg", g: "g", t: "t", s: "s", shots: "shots" };

function stdValue(a: Partial<Asset> | undefined, key: keyof Asset) {
  const v = a?.[key];
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && "toString" in v) return String(v);
  return String(v);
}

export function StandardFields({ kind, a }: { kind: string; a?: Partial<Asset> }) {
  const fields = stdFieldsFor(kind);
  const sections = [...new Set(fields.map((f) => f.section))];
  return (
    <>
      {sections.map((s) => (
        <fieldset key={s} className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">{s}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {fields.filter((f) => f.section === s).map((f) => (
              <Field key={f.key} label={`${f.label}${f.unit ? ` (${UNIT_LABEL[f.unit]})` : f.type === "money" ? " (₹)" : ""}`}>
                <Input name={f.var} type={f.type === "date" ? "date" : f.type === "text" ? "text" : "number"} step={f.type === "int" ? 1 : "any"} min={f.type === "text" || f.type === "date" ? undefined : 0} defaultValue={stdValue(a, f.key)} inputMode={f.type === "text" ? undefined : "decimal"} />
              </Field>
            ))}
          </div>
        </fieldset>
      ))}
    </>
  );
}

export function CustomFields({ defs, values }: { defs: FieldDef[]; values?: Record<string, unknown> }) {
  const editable = defs.filter((d) => d.type !== "formula" && !d.archived);
  if (!editable.length) return null;
  const sections = [...new Set(editable.map((d) => d.section))];
  return (
    <>
      {sections.map((s) => (
        <fieldset key={s}>
          <legend className="mb-2 text-sm font-semibold">{s}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {editable.filter((d) => d.section === s).map((d) => {
              const v = values?.[d.key];
              const name = `cf_${d.key}`;
              const label = `${d.label}${d.unit ? ` (${d.unit})` : ""}${d.required ? " *" : ""}`;
              return (
                <Field key={d.id} label={label} hint={d.helpText || undefined}>
                  {d.type === "picklist" ? (
                    <Select name={name} defaultValue={v == null ? "" : String(v)} options={d.options.map((o) => [o, o] as [string, string])} placeholder="—" />
                  ) : d.type === "boolean" ? (
                    <Select name={name} defaultValue={v === true ? "yes" : v === false ? "no" : ""} options={{ yes: "Yes", no: "No" }} placeholder="—" />
                  ) : (
                    <Input name={name} type={d.type === "number" ? "number" : d.type === "date" ? "date" : "text"} step="any" defaultValue={v == null ? "" : String(v)} required={d.required} />
                  )}
                </Field>
              );
            })}
          </div>
        </fieldset>
      ))}
    </>
  );
}
