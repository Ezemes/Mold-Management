# REA Findings — COAST Systems (public front-end pass)

Date: 2026-10-22 · Phase 1.2 · Analyst: Claude Code with REA 6.7.0

## Scope and method

| Item | Value |
| --- | --- |
| Target | `https://sales.cscoast.com/`: COAST Systems web application. The page title is "COAST Systems" and it is marked `noindex`. Unauthenticated visits redirect to `/login?returnUrl=/maintenance/workorder`. |
| Relationship | Third party. The user confirmed they are not the owner and have no authorization. |
| What was analysed | Only the JavaScript and CSS the server sends to **any unauthenticated visitor**: the main bundle and the 24 lazy chunks listed in the Angular runtime. That is 29 files, 11.1 MB. See `evidence/rea/coast-bundle-manifest.txt` for SHA-256 hashes. |
| What was *not* done | No login, no API calls to the backend, no crawling, no probing. Nothing was executed except the page load in a headless browser. |
| Tools | REA `analyze_javascript_application` (static AST analysis; evidence `ev_e08ead66…fd3e9`) for the module graph, 72 route/endpoint findings and 31 browser-storage keys. REA's result budget truncated the semantic pass on the 7 largest chunks; static facts were kept for all 29 files. Gaps were filled with a deterministic text pass over the same files for `/v1/…` API paths, `Entity.Field` label keys and Angular route definitions. |
| Source maps | Not published. The `.map` URLs return the SPA HTML fallback. |

Confidence labels: **Observed** means literally present in the shipped code. **Inferred** means reasoned from the code but not seen running. **Unknown** means not determinable without authenticated access.

## 1. Architecture (Observed)

- Angular single-page app (Angular CLI build: `runtime`, `polyfills`, `scripts`, `main`, plus lazy chunks). It also loads jQuery 2.1, Select2, Quill (rich text), compromise (NLP) and Prettier (standalone) from public CDNs, with Material Icons and Roboto.
- REST API under a configurable base URL, versioned `/v1/…`, called through a generic HTTP wrapper.
- **413 distinct `/v1` API paths across 157 resource groups.** Most entities follow the same pattern: `GET/POST/DELETE /v1/<Entity>`, a `POST /v1/<Entity>/Search` with a rich criteria object (paging, sort, group-by, date-range and "is null" filters), plus domain operations.
- Multi-tenant SaaS: a `Tenant` entity has a subdomain, licence fees and expiry, and location count. `GetTenantIDAsString` exists.
- Auth: password with configurable password rules, **MFA**, **passkeys (WebAuthn)**, **SAML SSO** (`/saml/:apiKey`) with SSO→role and SSO→location mapping, account deletion and change-password.
- Search UIs persist criteria, columns and layout in `localStorage` (for example `WorkOrderSearch-Criteria`, `PartSearch-Columns`, `PartBarcodes-Layout`).

## 2. Modules and screens (Observed: route tree)

| Module | Route prefix | Screens (route paths) |
| --- | --- | --- |
| **Assets** (molds) | `/assets` | search, asset detail, create/import by asset type, asset & product lookup, **condition evaluation** worksheets and condition report, **self-assessments**, **qualification (IQ/OQ/PQ)**, **budgeting** and budget report, **capacity planning** with assumptions, cost, meter history, update meters, barcodes and tag printing, files, wellness report, division/segment drill-down |
| **Maintenance** | `/maintenance` (default landing) | work orders, my work, watched items, PM sheets (checklists) and templates, inspections, schedule setting, task lists, work-order and sheet **compliance** reports |
| **Inventory** | `/inventory` | parts search and detail, quantities and storage locations, transactions ledger, reorder, barcode printing, vendors, **purchasing** (purchase initiations → requisitions → purchase orders → awaiting receipt) |
| **Downtime** | `/downtime` | enter downtime, search, reports |
| **Projects** | `/projects` | projects, project templates, target vs actual and target-to-spend reports, currencies |
| **Safety & training** | `/safetytraining` | safety observations, defect evaluations, training tasks and records, **quizzes** (take, results, statistics) |
| **Reports** | `/reports` | saved reports, table reports, status reports, dashboards, **embedded QuickSight dashboards**, asset data-health and system-health |
| **Files** | `/files` | document search and viewer |
| **AI** | `/ai` | setup, settings, dashboard, playground (chat, fetch, graph) |
| **Administration** | `/administration` | ~65 screens: users, roles, groups, role audit, role maps, SSO, clients, divisions, departments, locations and location map, asset types, **screen designer**, extra (custom) fields per entity, picklists for work-order states, priorities, categories and root causes, downtime codes, frequencies, currencies, suppliers, SKUs, quality defects, **workflow engines (v1 and v2)**, import/export, FTP/SFTP accounts, email and event logs, notifications, usage, scorecards, user change requests |

## 3. Mold-specific domain model (Observed field labels, inferred meaning)

The bundle contains 311 entities with 3+ labelled fields (6,214 field labels). The mold-relevant core:

- **Asset (mold).** Identity, type, parent/children (**component hierarchy**) and **sister molds**; location, department and division; status; **design cavities and cavity identifier**; **design cycle time**; **shot warranty, shots between refurbishments, refurbishments allowed/completed, last refurbishment date, refurbishment duration**; build, capitalization and warranty-end dates; cost and cost centre with currency; material codes; linked **products** (part numbers it produces) and annual demand; condition averages (plain, weighted, critical); risk-metric score; meters and meter triggers; qualification; projects; budget items; GPS latitude/longitude; work orders, sheets, files and comments.
- **Asset type.** A configurable template: which features are on (`HasMaintenance`, `HasMeters`, `HasTransfers`, `HasQualifications`, `HasProducts`, `HasComponents`, `HasDowntime`, `HasInventory`…), **formulas** that derive standard fields from custom fields (cavities, cycle time, cost and so on), the cycle-count meter, parts-per-cycle, end-of-life cycles, and budgeting rules for annual PM, spare parts, refurbishment and replacement.
- **Meters and triggers.** Meter values (cycle counts, hours). **Meter triggers** fire maintenance when a value crosses upper/lower bounds, at a frequency or after hours elapsed. They create a work order from a template and notify a user.
- **Cycle aggregation (IIoT).** `AssetCycleAggregate` breaks production into run, idle, downtime (small and large), maintenance and quality cycles and times, actual vs design cycle time, and parts created vs possible, hourly and daily.
- **IIoT ingestion (Inferred).** A workflow engine calls an external **mould-device API** (`GetMoldDeviceHistory/{mouldShortId}`) and maps a device number held in a custom field onto counter and temperature sensors. The steps look like AWS Step Functions (`Parameters.Path.$`).
- **Condition evaluation.** Weighted condition scoring per asset with measurements and photo uploads, a submit → approve/reject cycle, and next-evaluation scheduling. It can raise work orders.
- **Qualification (IQ/OQ/PQ).** Stages, stage status, reason, approver, planned and actual completion; linked to a work order and specification.
- **Maintenance.** Work orders with configurable states, a state machine, priority, category, root cause, assigned user or group, scheduled and target dates, labour, parts used, quotes and POs, and cost roll-ups. **PM sheets** are checklists from **maintenance templates** with frequency, tasks, a bill of materials, signatures and a pass percentage.
- **Budgeting.** Per-asset, per-year budget items (category, type, status, designation, cost each, quantity, optionally × cavities), templates and mass-apply, adjustment history and reasons, and budget-state triggers.
- **Capacity planning.** Plans by month: demand vs capacity per asset and product, using OEE, parts-per-cycle, cycle time, allocation %, end-of-life and refurbishment events. Raises concerns when demand exceeds capacity, and supports hypothetical (what-if) assets.
- **Inventory and purchasing.** Parts with OEM numbers, bin/shelf/cabinet locations, a stock ledger, reorder flags and shelf life; purchase initiation → requisition → purchase order (terms, states, extra fields) → receipt; vendors and suppliers.
- **Locations and suppliers.** Plants and **supplier sites** with address, time zone, coordinates and operating hours. Assets at supplier locations are how **global/distributed custody** is represented (Inferred).

## 4. Coverage vs the project checklist

| Domain | Status after this pass |
| --- | --- |
| Tenancy, organisations, sites, users | partial (model and screens observed; behaviour unknown) |
| Asset registry and hierarchy | partial (model and screens observed) |
| Mold digital passport | partial (specs, cavities, components, files, products observed) |
| Machine/press compatibility | **not found**: no press entity; only product↔asset links and capacity data |
| Mold transfer lifecycle | partial. Transfers are a per-asset-type feature flag; location changes appear in asset history. **No dedicated dispatch/transit/receipt workflow was found.** |
| Ownership vs custody vs location | partial (location, supplier location, department and division observed; separate ownership not observed) |
| Cycle counters and usage | partial (meters, triggers, IIoT aggregates observed) |
| Maintenance plans, inspections, work orders, thresholds | partial (strongest coverage) |
| Spare parts / inventory | partial |
| Supplier and customer portals | unknown (supplier entities exist; no separate portal routes) |
| Lifecycle cost, availability, utilisation reports | partial (budget, capacity, cost, QuickSight) |
| Dashboards and alerts | partial |
| Imports, exports, APIs, IIoT | partial (import/export types, BOM import/export, FTP/SFTP, IIoT workflows) |
| Roles, permissions, audit | partial (roles, groups, role audit, event and email logs) |
| Mobile app | not found in this bundle |

## 5. Unknowns (need authenticated access or vendor documentation)

1. Server-side behaviour: validation, permission enforcement, state-machine rules, trigger evaluation and budget/capacity calculations.
2. API response payloads (only request shapes and UI usage are visible).
3. The actual screens and UX, which are only visible after login.
4. How transfers work end to end, if more than a location change.
5. What the AI module does with tenant data.

## 6. Use of these findings

The new product reproduces **functional capability** with original design, code, naming and copy. Nothing from the COAST bundle (code, text, styling, assets) is copied. The raw extraction lists (full API path list and full field-label list) are kept out of this public repository. They can be added if the repository is made private.
