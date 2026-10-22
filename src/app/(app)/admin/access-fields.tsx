import { Field, Select } from "@/components/ui";

type Opt = { id: string; name: string };

/** Role + data-scope inputs. Supplier roles use the partner; others use all / sites / divisions. */
export function AccessFields({
  roles,
  sites,
  divisions,
  partners,
  value,
}: {
  roles: (Opt & { isSupplier: boolean })[];
  sites: Opt[];
  divisions: Opt[];
  partners: Opt[];
  value?: { roleId?: string; scopeType?: string; scopeIds?: string[]; partnerId?: string | null };
}) {
  const v = value ?? {};
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Role">
        <Select name="roleId" defaultValue={v.roleId} options={roles.map((r) => [r.id, r.isSupplier ? `${r.name} (supplier)` : r.name] as [string, string])} />
      </Field>
      <Field label="Partner (supplier roles only)" hint="Supplier users see only molds in this partner's custody.">
        <Select name="partnerId" defaultValue={v.partnerId ?? ""} options={partners.map((p) => [p.id, p.name] as [string, string])} placeholder="—" />
      </Field>
      <Field label="Data scope (internal roles)" className="sm:col-span-2">
        <Select name="scopeType" defaultValue={v.scopeType ?? "all"} options={{ all: "Whole organisation", sites: "Selected sites", divisions: "Selected divisions" }} />
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="label">Sites / divisions in scope</legend>
        <div className="grid max-h-48 gap-1 overflow-y-auto rounded-md border border-gray-200 p-2 text-sm sm:grid-cols-2">
          {divisions.map((d) => (
            <label key={d.id} className="flex items-center gap-2"><input type="checkbox" name="scopeIds" value={d.id} defaultChecked={v.scopeIds?.includes(d.id)} /> <span className="text-ink-500">Division:</span> {d.name}</label>
          ))}
          {sites.map((s) => (
            <label key={s.id} className="flex items-center gap-2"><input type="checkbox" name="scopeIds" value={s.id} defaultChecked={v.scopeIds?.includes(s.id)} /> <span className="text-ink-500">Site:</span> {s.name}</label>
          ))}
          {!divisions.length && !sites.length && <p className="text-ink-500">No sites yet.</p>}
        </div>
        <p className="mt-1 text-xs text-ink-500">Only the boxes matching the chosen scope type are used.</p>
      </fieldset>
    </div>
  );
}
