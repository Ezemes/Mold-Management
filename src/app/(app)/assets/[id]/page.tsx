import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireOrg, siteScope } from "@/lib/auth";
import { loadPassport, custodianName } from "@/lib/passport";
import { ASSET_STATUS, COMPONENT_ROLES, DOC_CATEGORIES, stdFieldsFor } from "@/lib/assets";
import { label } from "@/lib/labels";
import { dateToLocalInput, fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtUnit } from "@/lib/format";
import { DELETION_REASON_HINT } from "@/lib/copy";
import { Badge, btnClass, Card, cx, EmptyState, Field, FlashFromParams, Input, Notice, PageHeader, Select, Stat, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { LifeBar } from "@/components/life-bar";
import { CalcValue } from "@/components/calc-value";
import { CALC_FIELDS, type Calc, type CalcKey } from "@/lib/calc.pure";
import { moldsForPress, pressesForMold } from "@/lib/compat";
import { planState, woCost, WO_BADGE, WO_STATUS, WO_TYPES, workOrderScope } from "@/lib/maintenance";
import {
  addProductAction,
  addReadingAction,
  attachComponentAction,
  correctCustodyAction,
  deleteAssetAction,
  detachComponentAction,
  generateCavitiesAction,
  moveAssetAction,
  removeProductAction,
  setCavityAction,
  setStatusAction,
  uploadDocumentAction,
} from "../actions";

const TABS = [
  ["overview", "Overview"],
  ["specs", "Specifications"],
  ["calculated", "Calculated fields"],
  ["components", "Components & cavities"],
  ["counter", "Shot counter"],
  ["documents", "Documents"],
  ["maintenance", "Maintenance"],
  ["presses", "Presses"],
  ["quality", "Condition & qualification"],
  ["custody", "Custody & transfers"],
  ["history", "History"],
] as const;

export default async function PassportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(["assets", "view"]);
  const p = await loadPassport(ctx, id);
  if (!p) notFound();
  const { asset: a, live } = p;
  const org = ctx.org;
  const tz = org.timezone;
  const kind = a.assetType.kind;
  const tabs = TABS.filter(([k]) => (k === "counter" ? live.features.meters : k === "documents" ? live.features.documents && ctx.can("documents") : k === "history" ? ctx.can("audit") || !ctx.isSupplier : k === "custody" ? ctx.can("transfers") : k === "maintenance" ? ctx.can("maintenance") : k === "calculated" ? kind === "mold" : k === "presses" ? kind === "mold" || kind === "press" : k === "quality" ? ctx.can("quality") && kind !== "press" : k === "components" ? live.features.components || live.features.cavities || live.features.products : true));
  const tab = tabs.find(([k]) => k === sp.tab)?.[0] ?? "overview";
  const hid = <input type="hidden" name="id" value={a.id} />;
  const canEdit = ctx.can("assets", "edit");
  const custodian = custodianName(a, org.name);
  const confirmHint = sp.error?.endsWith("[confirm]");
  const error = sp.error?.replace(/ \[confirm\]$/, "");

  const custody = tab === "custody" ? await db.transferItem.findMany({
    where: { assetId: a.id, transfer: { status: { notIn: ["draft"] } } },
    include: { transfer: { include: { fromSite: true, toSite: true, fromPartner: true, toPartner: true } }, handovers: true, disputes: true },
    orderBy: { createdAt: "desc" },
  }) : [];
  const corrections = tab === "custody" ? await db.auditEvent.findMany({ where: { orgId: org.id, entityType: "asset", entityId: a.id, action: { in: ["custody_corrected", "created"] } }, orderBy: { createdAt: "desc" }, include: { user: true } }) : [];
  const [plans, workOrders] = tab === "maintenance" ? await Promise.all([
    db.maintenancePlan.findMany({ where: { assetId: a.id }, include: { template: true }, orderBy: { createdAt: "asc" } }),
    db.workOrder.findMany({ where: { AND: [workOrderScope(ctx), { assetId: a.id }] }, include: { labor: true, parts: true }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]) : [[], []];
  const [evals, quals] = tab === "quality" ? await Promise.all([
    db.conditionEvaluation.findMany({ where: { assetId: a.id }, orderBy: { evaluatedAt: "desc" }, take: 50 }),
    db.qualification.findMany({ where: { assetId: a.id }, include: { press: true }, orderBy: { createdAt: "desc" } }),
  ]) : [[], []];
  const compat = tab === "presses" ? (kind === "press" ? await moldsForPress(ctx, a.id) : await pressesForMold(ctx, a.id)) : [];
  const [readings, history, moveSites, allSites] = await Promise.all([
    tab === "counter" && live.shots ? db.meterReading.findMany({ where: { meterId: live.shots.id }, orderBy: { readAt: "desc" }, take: 100, include: { enteredBy: true } }) : Promise.resolve([]),
    tab === "history" ? db.auditEvent.findMany({ where: { orgId: org.id, entityType: "asset", entityId: a.id }, orderBy: { createdAt: "desc" }, take: 100, include: { user: true } }) : Promise.resolve([]),
    tab === "overview" && canEdit ? db.site.findMany({ where: { AND: [siteScope(ctx), { active: true, partnerId: a.custodianPartnerId }] }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    tab === "overview" && ctx.can("assets", "delete") ? db.site.findMany({ where: { orgId: org.id, active: true }, include: { partner: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        back={a.parent ? { href: `/assets/${a.parent.id}?tab=components`, label: `Component of ${a.parent.number}` } : { href: "/assets", label: "Assets" }}
        title={<span className="flex flex-wrap items-center gap-3">{a.number} <span className="font-normal text-ink-700">{a.name}</span> <Badge status={a.status}>{label(ASSET_STATUS, a.status)}</Badge></span>}
        subtitle={`${a.assetType.name}${a.program ? ` · ${a.program}` : ""}`}
        actions={
          <>
            {live.features.meters && ctx.can("readings", "create") && <Link href={`/assets/${a.id}?tab=counter`} className={btnClass("primary")}>Record shots</Link>}
            {ctx.can("transfers", "create") && a.status === "active" && <Link href={`/transfers/new?asset=${a.id}`} className={btnClass("secondary")}>Transfer</Link>}
            <Link href={`/assets/${a.id}/tag`} className={btnClass("secondary")}>QR tag</Link>
            {canEdit && <Link href={`/assets/${a.id}/edit`} className={btnClass("secondary")}>Edit</Link>}
          </>
        }
      />
      <FlashFromParams params={{ ok: sp.ok, error }} />
      {a.requalificationReason && <Notice tone="warn">Re-qualification required: {a.requalificationReason}.{ctx.can("quality", "create") && !ctx.isSupplier && <> <Link href={`/quality/qualifications/new?asset=${encodeURIComponent(a.number)}`} className="underline">Start a qualification</Link>.</>}</Notice>}
      {live.readingOverdue && <Notice tone="warn">No shot reading for more than {org.readingOverdueDays} days. Record the current counter value.</Notice>}

      <nav className="mb-6 flex flex-wrap gap-1 border-b border-gray-200">
        {tabs.map(([k, l]) => (
          <Link key={k} href={`/assets/${a.id}?tab=${k}`} className={cx("-mb-px border-b-2 px-3 py-2 text-sm", k === tab ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-ink-500 hover:text-ink-900")}>{l}</Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="space-y-6">
          {live.features.meters && (
            <div className="grid gap-4 sm:grid-cols-4">
              <Stat label="Lifetime shots" value={fmtNum(live.lifetimeShots, org)} hint={live.shots?.lastReadingAt ? `as of ${fmtDate(live.shots.lastReadingAt, tz)}` : "no reading yet"} />
              <Stat label="End of life" value={live.endOfLifePct != null ? <LifeBar pct={live.endOfLifePct} /> : "—"} hint={live.shotsToEndOfLife != null ? `${fmtNum(live.shotsToEndOfLife, org)} shots left` : "set end-of-life shots"} />
              <Stat label="Warranty used" value={live.warrantyPct != null ? `${live.warrantyPct.toFixed(1)}%` : "—"} hint={a.warrantyShots ? `of ${fmtNum(a.warrantyShots, org)} shots` : undefined} />
              <Stat label="Active cavities" value={live.activeCavities ?? "—"} hint={live.blockedCavities ? `${live.blockedCavities} blocked of ${a.designCavities ?? a.cavities.length}` : a.designCavities ? `design ${a.designCavities}` : undefined} />
            </div>
          )}
          {kind === "mold" && live.calc && (
            <div className="grid gap-4 sm:grid-cols-4">
              {(["refurbishmentPriority", "nextRefurbishment", "expectedEndOfLife", "remainingLifePct"] as const).map((k) => (
                <Stat key={k} label={CALC_FIELDS[k].label} value={<span className="text-lg"><CalcValue k={k} c={live.calc!.lifecycle[k]} org={org} currency={org.cavityCostCurrency} /></span>} hint={<Link href={`/assets/${a.id}?tab=calculated`} className="text-brand-700 hover:underline">All calculated fields</Link>} />
              ))}
            </div>
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Ownership, custody, location">
              <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
                <dt className="text-ink-500">Owner</dt><dd>{a.ownerPartner?.name ?? org.name}</dd>
                <dt className="text-ink-500">Custodian</dt><dd className="font-medium">{custodian}</dd>
                <dt className="text-ink-500">Site</dt><dd>{a.site.name}{a.site.city && <span className="text-ink-500"> · {a.site.city}{a.site.state ? `, ${a.site.state}` : ""}</span>}</dd>
                <dt className="text-ink-500">Location</dt><dd>{a.locationDetail || "—"}</dd>
                <dt className="text-ink-500">Assignment</dt><dd>{a.assignment || "—"}</dd>
                {a.toolmakerPartner && <><dt className="text-ink-500">Toolmaker</dt><dd>{a.toolmakerPartner.name}</dd></>}
              </dl>
              {canEdit && (
                <details className="mt-4 border-t border-gray-100 pt-3">
                  <summary className="cursor-pointer text-sm font-medium text-brand-700">Move within {custodian}</summary>
                  <form action={moveAssetAction} className="mt-3 grid gap-2 sm:grid-cols-2">
                    {hid}
                    <Field label="Site"><Select name="siteId" defaultValue={a.siteId} options={moveSites.map((s) => [s.id, s.name] as [string, string])} /></Field>
                    <Field label="Location at site"><Input name="locationDetail" defaultValue={a.locationDetail} /></Field>
                    <Field label="Note" className="sm:col-span-2"><Input name="reason" /></Field>
                    <div><SubmitButton size="sm">Move</SubmitButton></div>
                  </form>
                  <p className="mt-2 text-xs text-ink-500">Moving to another company needs a <Link href={`/transfers/new?asset=${a.id}`} className="text-brand-700 hover:underline">transfer</Link> with handovers at both ends.</p>
                </details>
              )}
              {ctx.can("assets", "delete") && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-red-700">Correct custody (admin)</summary>
                  <form action={correctCustodyAction} className="mt-3 grid gap-2 sm:grid-cols-2">
                    {hid}
                    <Field label="Correct site"><Select name="siteId" defaultValue={a.siteId} options={allSites.map((s) => [s.id, s.partner ? `${s.name} (${s.partner.name})` : s.name] as [string, string])} /></Field>
                    <Field label="Location at site"><Input name="locationDetail" defaultValue={a.locationDetail} /></Field>
                    <Field label="Reason (kept in the audit log)" className="sm:col-span-2"><Input name="reason" required minLength={10} /></Field>
                    <div><SubmitButton size="sm" variant="danger" confirm="Correct custody? This bypasses the transfer process and is logged.">Correct custody</SubmitButton></div>
                  </form>
                </details>
              )}
            </Card>
            <Card title="Status">
              {canEdit ? (
                <form action={setStatusAction} className="space-y-3">
                  {hid}
                  <Field label="Status"><Select name="status" defaultValue={a.status} options={Object.fromEntries(Object.entries(ASSET_STATUS).filter(([k]) => k !== "in_transfer"))} /></Field>
                  <Field label="Reason" hint="Required for quarantined, retired and scrapped. Quarantine raises a release work order that must be completed to lift it."><Input name="reason" /></Field>
                  <SubmitButton size="sm" variant="secondary">Update status</SubmitButton>
                </form>
              ) : (
                <p className="text-sm">{label(ASSET_STATUS, a.status)}</p>
              )}
              {a.notes && <p className="mt-4 whitespace-pre-wrap border-t border-gray-100 pt-3 text-sm text-ink-700">{a.notes}</p>}
            </Card>
          </div>
          {ctx.can("assets", "delete") && (
            <details className="text-sm">
              <summary className="cursor-pointer text-red-700">Delete asset…</summary>
              <form action={deleteAssetAction} className="mt-2 flex flex-wrap items-end gap-2">
                {hid}
                <Field label="Reason" hint={DELETION_REASON_HINT}><Input name="reason" required className="w-80" /></Field>
                <SubmitButton variant="danger" size="sm" confirm={`Delete ${a.number}? It stays in the audit log.`}>Delete</SubmitButton>
              </form>
            </details>
          )}
        </div>
      )}

      {tab === "specs" && (
        <div className="grid gap-6 lg:grid-cols-2">
          {[...new Set(stdFieldsFor(kind).map((f) => f.section))].map((s) => (
            <Card key={s} title={s}>
              <dl className="grid grid-cols-[1fr_1fr] gap-y-2 text-sm">
                {stdFieldsFor(kind).filter((f) => f.section === s).map((f) => {
                  const v = a[f.key];
                  const shown =
                    v == null || v === "" ? "—"
                    : f.type === "date" ? fmtDate(v as Date, tz)
                    : f.type === "money" ? fmtMoney(Number(v), org)
                    : f.unit && ["mm", "kg", "g", "t"].includes(f.unit) ? fmtUnit(Number(v), f.unit as "mm", org)
                    : typeof v === "number" ? `${fmtNum(v, org, 2)}${f.unit ? ` ${f.unit}` : ""}`
                    : String(v);
                  return [<dt key={`${f.key}-l`} className="text-ink-500">{f.label}</dt>, <dd key={`${f.key}-v`}>{shown}</dd>];
                })}
              </dl>
            </Card>
          ))}
          {a.assetType.fields.length > 0 && (
            <Card title="Custom fields">
              <dl className="grid grid-cols-[1fr_1fr] gap-y-2 text-sm">
                {a.assetType.fields.map((d) => {
                  const v = d.type === "formula" ? live.formulas[d.key] : (a.customValues as Record<string, unknown>)[d.key];
                  const shown = v == null || v === "" ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : typeof v === "number" ? fmtNum(v, org, 2) : String(v);
                  return [<dt key={`${d.id}-l`} className="text-ink-500">{d.label}{d.type === "formula" && <span title={d.formula}> ƒ</span>}</dt>, <dd key={`${d.id}-v`}>{shown}{d.unit && v != null ? ` ${d.unit}` : ""}</dd>];
                })}
              </dl>
            </Card>
          )}
        </div>
      )}

      {tab === "components" && (
        <div className="grid gap-6 lg:grid-cols-2">
          {live.features.cavities && (
            <Card title={`Cavities · ${live.activeCavities ?? 0} active`}>
              {a.cavities.length === 0 ? (
                canEdit ? (
                  <form action={generateCavitiesAction} className="flex flex-wrap items-end gap-2">
                    {hid}
                    <Field label="Number of cavities"><Input name="count" type="number" min={1} max={256} defaultValue={a.designCavities ?? ""} required className="w-28" /></Field>
                    <Field label="Prefix (optional)"><Input name="prefix" placeholder="C" className="w-24" /></Field>
                    <SubmitButton size="sm">Create cavities</SubmitButton>
                  </form>
                ) : <p className="text-sm text-ink-500">No cavities recorded.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {a.cavities.map((c) => (
                    <li key={c.id} className={cx("rounded-md border px-2 py-1.5 text-sm", c.status === "blocked" ? "border-amber-300 bg-amber-50" : "border-gray-200")}>
                      <span className="font-medium">Cavity {c.identifier}</span> {c.status === "blocked" && <Badge status="blocked" />}
                      {c.blockedReason && <p className="text-xs text-ink-500">{c.blockedReason}</p>}
                      {canEdit && (
                        <form action={setCavityAction} className="mt-1 flex gap-1">
                          {hid}
                          <input type="hidden" name="cavityId" value={c.id} />
                          <input type="hidden" name="block" value={c.status === "blocked" ? "0" : "1"} />
                          {c.status !== "blocked" && <input name="reason" placeholder="Reason" className="w-full rounded border border-gray-200 px-1 text-xs" />}
                          <button className="text-xs text-brand-700 hover:underline">{c.status === "blocked" ? "Unblock" : "Block"}</button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {live.features.products && (
            <Card title="Products made">
              <Table head={["Part number", "Name", "Cavities", "Customer", ""]} empty="No products linked.">
                {a.products.map((pr) => (
                  <tr key={pr.id}>
                    <Td className="font-medium">{pr.partNumber}</Td><Td>{pr.partName}</Td><Td>{pr.cavitiesUsed ?? "all"}</Td><Td>{pr.customer}</Td>
                    <Td>{canEdit && <form action={removeProductAction}>{hid}<input type="hidden" name="productId" value={pr.id} /><SubmitButton size="sm" variant="ghost">Remove</SubmitButton></form>}</Td>
                  </tr>
                ))}
              </Table>
              {canEdit && (
                <form action={addProductAction} className="mt-3 grid gap-2 sm:grid-cols-4">
                  {hid}
                  <Input name="partNumber" placeholder="Part number" required />
                  <Input name="partName" placeholder="Part name" />
                  <Input name="cavitiesUsed" type="number" min={1} placeholder="Cavities (family)" />
                  <Input name="customer" placeholder="Customer" />
                  <div><SubmitButton size="sm">Add product</SubmitButton></div>
                </form>
              )}
            </Card>
          )}
          {live.features.components && (
            <Card title={`Components (${a.components.length})`} className="lg:col-span-2">
              <Table head={["Component", "Role", "Status", ""]} empty="No components attached.">
                {a.components.map((c) => (
                  <tr key={c.id}>
                    <Td><Link href={`/assets/${c.id}`} className="font-medium hover:text-brand-700">{c.number}</Link> <span className="text-ink-700">{c.name}</span></Td>
                    <Td className="capitalize">{c.componentRole || "—"}</Td>
                    <Td><Badge status={c.status}>{label(ASSET_STATUS, c.status)}</Badge></Td>
                    <Td>{canEdit && <form action={detachComponentAction}>{hid}<input type="hidden" name="childId" value={c.id} /><SubmitButton size="sm" variant="ghost">Detach</SubmitButton></form>}</Td>
                  </tr>
                ))}
              </Table>
              {canEdit && (
                <form action={attachComponentAction} className="mt-3 flex flex-wrap items-end gap-2">
                  {hid}
                  <Field label="Attach existing asset (number)"><Input name="childNumber" required placeholder="E-0007" /></Field>
                  <Field label="Role"><Select name="componentRole" options={COMPONENT_ROLES.map((r) => [r, r] as [string, string])} /></Field>
                  <SubmitButton size="sm">Attach</SubmitButton>
                </form>
              )}
            </Card>
          )}
        </div>
      )}

      {tab === "counter" && live.shots && (
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          {ctx.can("readings", "create") && (
            <Card title="Record a reading">
              <form action={addReadingAction} className="space-y-3">
                {hid}
                <Field label="Counter value (shots)" hint={live.shots.lastRawValue != null ? `Last: ${fmtNum(live.shots.lastRawValue, org)}` : "First reading sets the baseline."}>
                  <Input name="value" inputMode="numeric" required autoFocus placeholder="e.g. 1,25,000" />
                </Field>
                <Field label={`Read at (${tz})`}><Input name="readAt" type="datetime-local" defaultValue={dateToLocalInput(new Date(), tz)} /></Field>
                <Field label="Note"><Input name="note" /></Field>
                <details>
                  <summary className="cursor-pointer text-xs text-ink-700">Counter was reset or replaced?</summary>
                  <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="isReset" /> This is a reset / new counter</label>
                  <Input name="resetReason" placeholder="Reason, e.g. counter replaced" className="mt-2" />
                </details>
                {confirmHint && <label className="flex items-center gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900"><input type="checkbox" name="confirmHigh" /> I have checked this value and it is correct</label>}
                <SubmitButton>Save reading</SubmitButton>
              </form>
            </Card>
          )}
          <Card title={`Readings · lifetime ${fmtNum(live.shots.lifetimeTotal, org)} shots`}>
            <Table head={["Read at", "Counter", "Δ shots", "Lifetime", "Source", "By"]} empty="No readings yet.">
              {readings.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.readAt, tz)}</Td>
                  <Td className="tabular-nums">{fmtNum(r.rawValue, org)}{r.isReset && <p className="text-xs text-amber-700">reset: {r.resetReason}</p>}</Td>
                  <Td className="tabular-nums">+{fmtNum(r.delta, org)}</Td>
                  <Td className="tabular-nums">{fmtNum(r.lifetime, org)}</Td>
                  <Td className="text-xs">{r.source}{r.note && <p className="text-ink-500">{r.note}</p>}</Td>
                  <Td className="text-xs">{r.enteredBy?.email ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}

      {tab === "documents" && (
        <div className="space-y-6">
          {ctx.can("documents", "create") && (
            <Card title="Add a document">
              <form action={uploadDocumentAction} className="grid gap-3 sm:grid-cols-4" encType="multipart/form-data">
                {hid}
                <Field label="Title" className="sm:col-span-2"><Input name="title" placeholder="Defaults to the file name" /></Field>
                <Field label="Category"><Select name="category" options={DOC_CATEGORIES} /></Field>
                <Field label="File (max 25 MB)"><input type="file" name="file" required className="block w-full text-sm" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.zip,.step,.stp,.igs,.stl,.dwg,.dxf" capture="environment" /></Field>
                <div className="sm:col-span-4"><SubmitButton pendingText="Uploading…">Upload</SubmitButton></div>
              </form>
            </Card>
          )}
          {a.documents.length === 0 ? <EmptyState title="No documents yet" body="Drawings, trial reports, certificates and photos live here, versioned." /> : (
            <div className="space-y-3">
              {a.documents.map((d) => (
                <div key={d.id} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{d.title} <Badge color="gray">{label(DOC_CATEGORIES, d.category)}</Badge></p>
                    {ctx.can("documents", "create") && (
                      <form action={uploadDocumentAction} className="flex items-center gap-2" encType="multipart/form-data">
                        {hid}
                        <input type="hidden" name="documentId" value={d.id} />
                        <input type="file" name="file" required className="max-w-56 text-xs" />
                        <input name="note" placeholder="What changed?" className="rounded border border-gray-200 px-2 py-1 text-xs" />
                        <SubmitButton size="sm" variant="secondary">New version</SubmitButton>
                      </form>
                    )}
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {d.versions.map((v, i) => (
                      <li key={v.id} className={i ? "text-ink-500" : ""}>
                        <a href={`/files/${v.id}`} className="text-brand-700 hover:underline">v{v.version} · {v.filename}</a>
                        <span className="text-xs"> · {(v.sizeBytes / 1024).toFixed(0)} KB · {fmtDateTime(v.createdAt, tz)} · {v.uploadedBy?.email ?? "—"}{v.note && ` · ${v.note}`}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "calculated" && live.calc && (
        <div className="space-y-6">
          <Notice tone="info">
            Calculated from this passport, its shot counter and the shift pattern of {a.site.name}. Fill in the fields named under “Needs” to complete a value.
            {canEdit && <> <Link href={`/assets/${a.id}/edit`} className="underline">Edit passport</Link>.</>}
            {ctx.can("sites", "edit") && <> <Link href="/admin/sites" className="underline">Edit site shift pattern</Link>.</>}
          </Notice>
          {(["lifecycle", "capacity"] as const).map((group) => (
            <Card key={group} title={group === "lifecycle" ? "Tool lifecycle" : "Capacity"}>
              <dl className="divide-y divide-gray-100">
                {(Object.entries(live.calc![group]) as [CalcKey, Calc<unknown>][]).map(([k, c]) => (
                  <div key={k} className="grid gap-1 py-2.5 sm:grid-cols-[16rem_1fr]">
                    <dt className="text-sm font-medium">{CALC_FIELDS[k].label}<span className="block text-xs font-normal text-ink-500">{CALC_FIELDS[k].help}</span></dt>
                    <dd className="text-sm">
                      <CalcValue k={k} c={c} org={org} currency={org.cavityCostCurrency} />
                      {c.value != null && c.note && <span className="block text-xs text-ink-500">{c.note}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          ))}
        </div>
      )}

      {tab === "maintenance" && (
        <div className="space-y-6">
          <Card
            title="Plans"
            actions={ctx.can("maintenance", "create") && !ctx.isSupplier && <Link href={`/maintenance/plans?asset=${encodeURIComponent(a.number)}`} className={btnClass("secondary", "sm")}>Add plan</Link>}
          >
            {plans.length === 0 ? <p className="text-sm text-ink-500">No maintenance plan. Add one to raise work orders automatically by shots or calendar.</p> : (
              <div className="space-y-3">
                {plans.map((pl) => {
                  const st = planState(pl, live.shots?.lifetimeTotal ?? null);
                  return (
                    <div key={pl.id} className={cx("text-sm", !pl.active && "opacity-50")}>
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="font-medium">{pl.template.name} · every {fmtNum(pl.interval, org)} {pl.triggerType}{!pl.active && " (paused)"}</span>
                        <span className="text-xs text-ink-500">{fmtNum(st.remaining, org)} {st.unit} to go · next at {st.unit === "shots" ? `${fmtNum(st.dueAtShots, org)} shots` : fmtDate(st.dueDate, tz)}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                        <div className={cx("h-full", st.status === "due" ? "bg-red-500" : st.status === "due_soon" ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, st.progress * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
          <Card
            title="Work orders"
            actions={ctx.can("maintenance", "create") && <Link href={`/maintenance/work-orders/new?asset=${encodeURIComponent(a.number)}`} className={btnClass("secondary", "sm")}>New work order</Link>}
          >
            <Table head={["Work order", "Type", "Status", "Due / done", "Cost"]} empty="No work orders yet.">
              {workOrders.map((w) => (
                <tr key={w.id}>
                  <Td><Link href={`/maintenance/work-orders/${w.id}`} className="font-medium hover:text-brand-700">{w.number}</Link><p className="text-xs text-ink-500">{w.title}</p></Td>
                  <Td className="text-xs">{label(WO_TYPES, w.type)}</Td>
                  <Td><Badge status={WO_BADGE[w.status]}>{label(WO_STATUS, w.status)}</Badge></Td>
                  <Td className="text-xs">{w.completedAt ? `Done ${fmtDate(w.completedAt, tz)}` : `Due ${fmtDate(w.dueDate, tz)}`}</Td>
                  <Td className="text-xs">{fmtMoney(woCost(w).total, org)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}

      {tab === "quality" && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Condition score" value={a.conditionScore != null ? `${a.conditionScore.toFixed(2)} / 5` : "—"} hint={a.conditionDate ? `Approved evaluation of ${fmtDate(a.conditionDate, tz)}` : "Not evaluated yet"} />
            <Stat label="Next evaluation" value={a.nextEvaluationDate ? fmtDate(a.nextEvaluationDate, tz) : "—"} hint={a.nextEvaluationDate && a.nextEvaluationDate < new Date() ? "Overdue" : undefined} />
            <Stat label="Qualification" value={a.requalificationReason ? "Required" : quals.some((q) => q.status === "passed") ? "Qualified" : "—"} hint={a.requalificationReason || undefined} />
          </div>
          <Card title="Evaluations" actions={ctx.can("quality", "create") && <Link href={`/quality/evaluations/new?asset=${a.id}`} className={btnClass("secondary", "sm")}>Evaluate</Link>}>
            {evals.filter((e) => e.status === "approved").length > 1 && (
              <p className="mb-3 text-xs text-ink-500">Trend (oldest → newest): {evals.filter((e) => e.status === "approved").reverse().map((e) => e.score.toFixed(1)).join(" → ")}</p>
            )}
            <Table head={["Date", "Score", "Status"]} empty="No evaluations yet.">
              {evals.map((e) => (
                <tr key={e.id}>
                  <Td><Link href={`/quality/evaluations/${e.id}`} className="hover:text-brand-700">{fmtDate(e.evaluatedAt, tz)}</Link></Td>
                  <Td>{e.score.toFixed(2)}</Td>
                  <Td><Badge status={e.status === "approved" ? "active" : e.status === "rejected" ? "suspended" : "pending"}>{e.status}</Badge></Td>
                </tr>
              ))}
            </Table>
          </Card>
          {kind === "mold" && (
            <Card title="Qualifications" actions={ctx.can("quality", "create") && !ctx.isSupplier && <Link href={`/quality/qualifications/new?asset=${encodeURIComponent(a.number)}`} className={btnClass("secondary", "sm")}>Start qualification</Link>}>
              <Table head={["Qualification", "Press", "Kind", "Status"]} empty="No qualifications yet.">
                {quals.map((q) => (
                  <tr key={q.id}>
                    <Td><Link href={`/quality/qualifications/${q.id}`} className="font-medium hover:text-brand-700">{q.number}</Link></Td>
                    <Td className="text-xs">{q.press?.number ?? "—"}</Td>
                    <Td className="text-xs">{q.kind === "requalification" ? "Re-qualification" : "Initial"}</Td>
                    <Td><Badge status={q.status === "passed" ? "active" : q.status === "failed" ? "suspended" : q.status === "cancelled" ? "archived" : "pending"}>{q.status.replace("_", " ")}</Badge></Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      )}

      {tab === "presses" && (
        <Card
          title={kind === "press" ? "Molds this press can run" : "Presses that can run this mold"}
          actions={<Link href={`/presses/finder?${kind === "press" ? "press" : "mold"}=${encodeURIComponent(a.number)}`} className={btnClass("secondary", "sm")}>Open finder</Link>}
        >
          {compat.filter((r) => r.status !== "incompatible").length === 0 ? (
            <p className="text-sm text-ink-500">No compatible {kind === "press" ? "molds" : "presses"}. The finder shows the reasons.</p>
          ) : (
            <Table head={[kind === "press" ? "Mold" : "Press", "Site", "Status", "Not checked"]}>
              {compat.filter((r) => r.status !== "incompatible").map((r) => (
                <tr key={r.other.id}>
                  <Td><Link href={`/assets/${r.other.id}?tab=presses`} className="font-medium hover:text-brand-700">{r.other.number}</Link><p className="text-xs text-ink-500">{r.other.name}</p></Td>
                  <Td className="text-xs">{r.other.site.name}</Td>
                  <Td>{r.status === "approved" ? <Badge color="green">Approved</Badge> : <Badge color="blue">Compatible (unqualified)</Badge>}</Td>
                  <Td className="text-xs text-ink-500">{r.verdict.unknowns.map((u) => u.label).join(", ") || "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-xs text-ink-500">{compat.filter((r) => r.status === "incompatible").length} incompatible.</p>
        </Card>
      )}

      {tab === "custody" && (
        <div className="space-y-4">
          <Card title="Chain of custody">
            <ol className="relative space-y-4 border-l border-gray-200 pl-5">
              <li>
                <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-brand-600" />
                <p className="text-sm font-medium">Now: {custodian} · {a.site.name}{a.locationDetail && ` · ${a.locationDetail}`}</p>
              </li>
              {custody.map((it) => {
                const tr = it.transfer;
                const out = it.handovers.find((h) => h.direction === "outbound");
                const inb = it.handovers.find((h) => h.direction === "inbound");
                return (
                  <li key={it.id}>
                    <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-gray-300" />
                    <p className="text-sm"><Link href={`/transfers/${tr.id}`} className="font-medium text-brand-700 hover:underline">{tr.number}</Link> · {tr.fromPartner?.name ?? org.name} ({tr.fromSite.name}) → {tr.toPartner?.name ?? org.name} ({tr.toSite.name}) <Badge status={it.status === "disputed" ? "quarantined" : tr.status === "completed" ? "active" : "pending"}>{it.status === "disputed" ? "disputed" : tr.status.replace("_", " ")}</Badge></p>
                    <p className="text-xs text-ink-500">
                      {out ? `Dispatched ${fmtDateTime(out.at, tz)}${out.shotReading != null ? ` at ${fmtNum(out.shotReading, org)} shots` : ""}` : "Not yet dispatched"}
                      {inb && ` · received ${fmtDateTime(inb.at, tz)}${inb.shotReading != null ? ` at ${fmtNum(inb.shotReading, org)} shots` : ""}`}
                      {it.disputes.length > 0 && ` · ${it.disputes.length} dispute(s)`}
                    </p>
                  </li>
                );
              })}
              {corrections.map((c) => (
                <li key={c.id}>
                  <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-amber-400" />
                  <p className="text-sm">{c.action === "created" ? "Registered" : "Custody corrected by admin"} · {fmtDateTime(c.createdAt, tz)} · {c.user?.email ?? "system"}</p>
                  {c.reason && <p className="text-xs text-ink-500">{c.reason}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}

      {tab === "history" && (
        <Table head={["When", "Who", "What", "Details"]} empty="No history yet.">
          {history.map((h) => (
            <tr key={h.id}>
              <Td className="whitespace-nowrap text-xs text-ink-500">{fmtDateTime(h.createdAt, tz)}</Td>
              <Td className="text-xs">{h.user?.email ?? "system"}</Td>
              <Td className="text-xs">{h.action.replace(/_/g, " ")}{h.reason && <p className="text-ink-500">Reason: {h.reason}</p>}</Td>
              <Td className="max-w-md text-xs text-ink-700">{h.after ? Object.entries(h.after as Record<string, unknown>).slice(0, 6).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") : ""}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
