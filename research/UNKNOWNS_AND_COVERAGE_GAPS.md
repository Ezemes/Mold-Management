# Unknowns and Coverage Gaps

Phase 1 is complete only when every in-scope row below is `inspected`, or is
`inaccessible` with the reason disclosed and the gap accepted by the product owner.

## Coverage checklist

Status values: `not started` · `in progress` · `inspected` · `partial` · `inaccessible`

| Domain | Status | Blocker |
| --- | --- | --- |
| Tenancy, organizations, sites, users | partial | Static only; behaviour needs login |
| Asset registry and hierarchy | partial | Static only |
| Mold digital passport (specs, components, documents) | partial | Static only |
| Machine / press compatibility | inspected — not present | No press entity in the public bundle |
| Mold transfer lifecycle (initiate → dispatch → transit → receipt → custody → history) | partial | Only a per-type `HasTransfers` flag and location history; no dispatch/receipt workflow observed |
| Ownership vs custody vs location vs assignment | partial | Location/supplier/department observed; ownership not observed |
| Cycle counters, production usage, reconciliation | partial | Meters, triggers, IIoT cycle aggregates observed |
| Maintenance plans, inspections, work orders, thresholds | partial | Static only |
| Spare parts / inventory | partial | Static only |
| Supplier and customer portals / visibility | inaccessible | No portal routes in public bundle; behaviour needs login |
| Lifecycle cost, availability, utilization reports | partial | Budgeting, capacity, cost, QuickSight observed |
| Dashboards and alerts / notifications | partial | Static only |
| Imports, exports, APIs, IIoT integrations | partial | Static only |
| Roles, permissions, audit history | partial | Static only |
| Mobile app (if any) | inspected — not present | None referenced in the bundle |

## Open questions blocking Phase 1

1. ~~Which product is the reference?~~ Resolved 2026-10-22: COAST Systems mold management.
2. ~~Relationship?~~ Resolved 2026-10-22: third party, no authorization. Analysis limited to public material.
3. ~~Reference URL(s)~~ Resolved: `https://sales.cscoast.com/`. Credentials are out of scope because COAST is a third party; authenticated behaviour stays `inaccessible` unless authorization is obtained.
4. Where is the "existing Coast Systems codebase" mentioned in the brief?
5. ~~Which repository holds this workspace?~~ Resolved: `Ezemes/Mold-Management`.
