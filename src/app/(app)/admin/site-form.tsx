import type { Site } from "@prisma/client";
import { SITE_KINDS } from "@/lib/assets";
import { INDIAN_STATES, TIMEZONES } from "@/lib/india";
import { Field, Input, Select } from "@/components/ui";

export function SiteFields({ s, divisions, partners, fixedPartnerId }: { s?: Partial<Site>; divisions: { id: string; name: string }[]; partners: { id: string; name: string }[]; fixedPartnerId?: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Name" className="sm:col-span-2"><Input name="name" defaultValue={s?.name} required /></Field>
      <Field label="Code"><Input name="code" defaultValue={s?.code} /></Field>
      <Field label="Type"><Select name="kind" defaultValue={s?.kind ?? (fixedPartnerId ? "supplier" : "plant")} options={SITE_KINDS} /></Field>
      {fixedPartnerId ? (
        <input type="hidden" name="partnerId" value={fixedPartnerId} />
      ) : (
        <Field label="Belongs to" hint="Leave empty for your own site."><Select name="partnerId" defaultValue={s?.partnerId ?? ""} options={partners.map((p) => [p.id, p.name] as [string, string])} placeholder="Own site" /></Field>
      )}
      <Field label="Division"><Select name="divisionId" defaultValue={s?.divisionId ?? ""} options={divisions.map((d) => [d.id, d.name] as [string, string])} placeholder="—" /></Field>
      <Field label="Address" className="sm:col-span-3"><Input name="address" defaultValue={s?.address} /></Field>
      <Field label="City"><Input name="city" defaultValue={s?.city} /></Field>
      <Field label="State / region">
        {(s?.country ?? "IN") === "IN" ? <Select name="state" defaultValue={s?.state ?? ""} options={INDIAN_STATES.map((x) => [x, x] as [string, string])} placeholder="—" /> : <Input name="state" defaultValue={s?.state} />}
      </Field>
      <Field label="PIN / postal code"><Input name="postalCode" defaultValue={s?.postalCode} /></Field>
      <Field label="Country (ISO code)"><Input name="country" defaultValue={s?.country ?? "IN"} maxLength={2} /></Field>
      <Field label="Time zone"><Select name="timezone" defaultValue={s?.timezone ?? "Asia/Kolkata"} options={TIMEZONES.map((t) => [t, t] as [string, string])} /></Field>
      <Field label="Status"><Select name="active" defaultValue={s?.active === false ? "0" : "1"} options={{ "1": "Active", "0": "Inactive" }} /></Field>
      <Field label="Latitude"><Input name="latitude" type="number" step="any" defaultValue={s?.latitude ?? ""} /></Field>
      <Field label="Longitude"><Input name="longitude" type="number" step="any" defaultValue={s?.longitude ?? ""} /></Field>
    </div>
  );
}
