import type { Partner } from "@prisma/client";
import { PARTNER_KINDS } from "@/lib/assets";
import { Field, Input, Select } from "@/components/ui";

export function PartnerFields({ p }: { p?: Partial<Partner> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Company name" className="sm:col-span-2"><Input name="name" defaultValue={p?.name} required /></Field>
      <Field label="Type"><Select name="kind" defaultValue={p?.kind ?? "molder"} options={PARTNER_KINDS} /></Field>
      <Field label="Code"><Input name="code" defaultValue={p?.code} /></Field>
      <Field label="GSTIN" hint="Optional, Indian partners"><Input name="gstin" defaultValue={p?.gstin} maxLength={15} /></Field>
      <Field label="Country (ISO code)"><Input name="country" defaultValue={p?.country ?? "IN"} maxLength={2} /></Field>
      <Field label="Contact name"><Input name="contactName" defaultValue={p?.contactName} /></Field>
      <Field label="Contact email"><Input name="contactEmail" type="email" defaultValue={p?.contactEmail} /></Field>
      <Field label="Contact phone"><Input name="contactPhone" type="tel" defaultValue={p?.contactPhone} /></Field>
      <Field label="Status"><Select name="status" defaultValue={p?.status ?? "active"} options={{ active: "Active", inactive: "Inactive" }} /></Field>
    </div>
  );
}
