"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertCan, requireOrg } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { FEATURE_LABELS, STD_FIELDS, slugKey, type Features } from "@/lib/assets";
import { compileFormula } from "@/lib/formula";
import { str } from "@/lib/forms";

function back(path: string, msg: string, kind: "error" | "ok" = "error"): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
}

const FIELD_TYPES = ["text", "number", "date", "boolean", "picklist", "formula"];
const RESERVED = new Set([...STD_FIELDS.map((f) => f.var), "active_cavities", "lifetime_shots", "number", "name", "status", "site", "type"]);

export async function saveAssetTypeAction(fd: FormData) {
  const ctx = await requireOrg();
  const id = str(fd, "id");
  assertCan(ctx, "asset_types", id ? "edit" : "create");
  const name = str(fd, "name");
  const path = id ? `/admin/asset-types/${id}` : "/admin/asset-types";
  if (!name) back(path, "Name is required.");
  const features = Object.fromEntries(Object.keys(FEATURE_LABELS).map((k) => [k, fd.get(`feature.${k}`) === "on"])) as Features;
  const data = { name, description: str(fd, "description"), numberPrefix: str(fd, "numberPrefix").slice(0, 10), features, archived: str(fd, "archived") === "1" };
  if (id) {
    const before = await db.assetType.findFirstOrThrow({ where: { id, orgId: ctx.org.id } });
    const after = await db.assetType.update({ where: { id }, data });
    await audit(ctx, { action: "updated", entityType: "asset_type", entityId: id, entityLabel: name, before, after });
    back(path, "Asset type saved.", "ok");
  }
  const kind = ["mold", "press", "equipment"].includes(str(fd, "kind")) ? str(fd, "kind") : "equipment";
  let key = slugKey(name);
  for (let i = 2; await db.assetType.findFirst({ where: { orgId: ctx.org.id, key } }); i++) key = `${slugKey(name)}_${i}`;
  const t = await db.assetType.create({ data: { ...data, orgId: ctx.org.id, key, kind } });
  await audit(ctx, { action: "created", entityType: "asset_type", entityId: t.id, entityLabel: name, after: t });
  back(`/admin/asset-types/${t.id}`, "Asset type created. Add custom fields below.", "ok");
}

export async function saveFieldAction(fd: FormData) {
  const ctx = await requireOrg();
  const typeId = str(fd, "typeId");
  const id = str(fd, "id");
  assertCan(ctx, "asset_types", "edit");
  const t = await db.assetType.findFirst({ where: { id: typeId, orgId: ctx.org.id }, include: { fields: true } });
  const path = `/admin/asset-types/${typeId}`;
  if (!t) back("/admin/asset-types", "Asset type not found.");
  const label = str(fd, "label");
  if (!label) back(path, "Field label is required.");
  const type = id ? t.fields.find((f) => f.id === id)!.type : str(fd, "type");
  if (!FIELD_TYPES.includes(type)) back(path, "Choose a field type.");
  const options = type === "picklist" ? [...new Set(str(fd, "options").split(/[\n,]/).map((s) => s.trim()).filter(Boolean))] : [];
  if (type === "picklist" && options.length < 2) back(path, "A picklist needs at least two options (comma or line separated).");
  const formula = type === "formula" ? str(fd, "formula") : "";
  if (type === "formula") {
    let refs: string[] = [];
    let syntaxError = "";
    try {
      refs = compileFormula(formula).refs;
    } catch (e) {
      syntaxError = e instanceof Error ? e.message : "invalid formula";
    }
    if (syntaxError) back(path, `Formula error: ${syntaxError}`);
    const known = new Set([...STD_FIELDS.map((f) => f.var), "active_cavities", "lifetime_shots", ...t.fields.filter((f) => (f.type === "number" || f.type === "formula") && f.id !== id).map((f) => f.key)]);
    const unknown = refs.filter((r) => !known.has(r));
    if (unknown.length) back(path, `Unknown variable(s) in formula: ${unknown.join(", ")}`);
  }
  const data = {
    label,
    unit: str(fd, "unit").slice(0, 20),
    options,
    formula,
    required: type !== "formula" && str(fd, "required") === "on",
    section: str(fd, "section") || "Additional",
    helpText: str(fd, "helpText"),
    sortOrder: parseInt(str(fd, "sortOrder"), 10) || 0,
    archived: str(fd, "archived") === "on",
  };
  if (id) {
    const before = t.fields.find((f) => f.id === id)!;
    const after = await db.fieldDef.update({ where: { id }, data });
    await audit(ctx, { action: "updated", entityType: "custom_field", entityId: id, entityLabel: `${t.name}: ${label}`, before, after });
    back(path, "Field saved.", "ok");
  }
  const key = str(fd, "key") ? slugKey(str(fd, "key")) : slugKey(label);
  if (RESERVED.has(key)) back(path, `"${key}" is reserved for a standard field. Choose another key.`);
  if (t.fields.some((f) => f.key === key)) back(path, `A field with key "${key}" exists on this type.`);
  const f = await db.fieldDef.create({ data: { ...data, assetTypeId: t.id, key, type } });
  await audit(ctx, { action: "created", entityType: "custom_field", entityId: f.id, entityLabel: `${t.name}: ${label}`, after: f });
  back(path, `Field "${label}" added (key: ${key}).`, "ok");
}
