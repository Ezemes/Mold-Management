# Phase 2 — Product Specification (draft for approval)

Status: **v1.0 — approved 2026-10-22. Phase 3a (Foundation) built; see README.**
Inputs: `research/REA_FINDINGS_COAST.md` (public front-end analysis of the reference) and the original brief: "Unified EAM platform with specialized global mold management".

Product name: **Plant Metrics Mold Management** (short form in this spec: **PMMM**). (D1)

## How to read this spec

Each capability is tagged with where it came from:

| Tag | Meaning |
| --- | --- |
| **[R]** | The reference product has an equivalent (observed in its public code). We match the capability with our own design. |
| **[N]** | New. A gap in the reference that the brief needs (e.g. transfer lifecycle, press compatibility). |
| **[D]** | A design decision we made where the reference's behaviour is unknown (server-side or behind the login). |

Nothing is copied from the reference: no code, text, layout, naming or assets. Requirements describe **outcomes**, not their implementation.

---

## 1. Product vision

OEMs and molders own thousands of injection molds spread across their own plants and a network of suppliers and molders. Today they lose track of **where a mold is, who has it, what condition it is in, how many shots it has left, and whether it can run on a given press**. PMMM is the system of record for every mold through its life: build → qualification → production → maintenance and refurbishment → transfer → end of life. It also covers general plant equipment (EAM) on the same foundation.

### Goals (Phase 3 MVP success measures)

1. Every mold has one **digital passport**: specs, components, documents and history in one place.
2. Location **and** custody of every mold are known at all times, with a full chain-of-custody history across companies.
3. Maintenance is triggered by **shot count** (entered manually, from handovers or by import), not just the calendar, and refurbishment and end of life are forecast.
4. A planner can answer "which presses can run this mold?" and "do we have enough capacity next quarter?" in under a minute.
5. Suppliers update the molds in their custody through a restricted portal, so data stays current without email chains.

### Non-goals (for now)

- Press scheduling / MES (we read production counts; we do not schedule jobs).
- Full ERP purchasing and finance (we keep spare parts and work-order costs, and integrate with ERP for the rest).
- Mold design or simulation.

---

## 2. Users and roles

| Persona | Typical org | Needs |
| --- | --- | --- |
| **Tooling manager** (OEM) | Owner | Global view of all molds, transfers, budget, end-of-life forecasting |
| **Maintenance technician** | Owner or supplier plant | Work orders, PM checklists, record cycle counts, mobile-friendly |
| **Quality / qualification engineer** | Owner | IQ/OQ/PQ qualification, condition evaluations, defects |
| **Production planner** | Owner | Press compatibility, capacity vs demand |
| **Supplier user** | Molder / toolmaker / warehouse | Sees only molds in their custody; confirms receipt, records shots and maintenance, uploads documents |
| **Finance / purchasing** | Owner | Lifecycle cost, budget per mold and year, parts spend |
| **Tenant admin** | Owner | Users, roles, sites, custom fields, integrations |
| **Platform operator** | Us | Tenants, licensing, support, health |

### Role model [R]+[D]

- **Organisation** = the tenant (the OEM). Within it: **Divisions → Sites (plants)**. **Partner organisations** (suppliers and molders) are linked companies with their own sites and users. [N: first-class partners]
- Permissions are **role-based plus scoped**. A role grants actions (view, create, edit, approve, delete, admin) per module. A user's **scope** limits which sites, divisions or partner organisations they see.
- Built-in roles: Org Admin, Tooling Manager, Planner, Quality Engineer, Technician, Viewer, **Supplier Admin**, **Supplier User**. Admins can create custom roles.
- Every create, update, delete, approval and custody change is written to an **immutable audit log** (who, when, before and after).

---

## 3. Domain model

### 3.1 Core entities

```
Organisation (tenant)
 ├─ Division ─ Site (plant | supplier site | warehouse | toolmaker)   [location + timezone + coordinates]
 ├─ PartnerOrganisation (supplier / molder / toolmaker) ─ its Sites, its Users
 ├─ AssetType (Mold, Press, Hot-runner controller, Gauge, General equipment…)   [configurable fields & features]
 ├─ Asset
 │   ├─ Mold (asset subtype) ─ Components (inserts, slides, cores…) ─ Cavities
 │   ├─ Press (asset subtype)
 │   ├─ Products (part numbers the mold produces)
 │   ├─ Meters (shot counter, hours) ─ MeterReadings
 │   ├─ Documents (drawings, certificates, photos) ─ versioned
 │   └─ Custody & Location history
 ├─ Transfer ─ TransferLeg ─ Handover (with condition snapshot)
 ├─ MaintenancePlan ─ Trigger (shots | calendar | hours | condition) ─ Template (checklist + BOM)
 ├─ WorkOrder ─ Tasks, Labor, Parts used, Costs, Attachments
 ├─ ConditionEvaluation ─ Criteria scores ─ photos
 ├─ Qualification (IQ/OQ/PQ) ─ Stages
 ├─ Part (spare) ─ Stock per Site ─ Ledger
 ├─ BudgetItem (per asset per year)
 ├─ CapacityPlan ─ Demand per product per month ─ Concerns
 └─ AuditEvent, Notification, CustomField definitions
```

### 3.2 The four separate concepts [N]

The reference only shows location. PMMM keeps four things apart, because in a supplier network they diverge:

| Concept | Question it answers | Example |
| --- | --- | --- |
| **Ownership** | Who owns the asset financially? | OEM "Acme" owns mold M-1042 |
| **Custody** | Who is responsible for it right now? | Molder "Brightway Plastics" holds it |
| **Location** | Where is it physically? | Brightway, Site Querétaro, Bay 4 |
| **Assignment** | What is it planned to run on, and for whom? | Press P-17, program X-200 |

Custody changes **only** through a completed transfer handover (§4.1). Location can change within a custodian's sites without a transfer (an intra-site move, logged).

### 3.3 Mold passport fields

These are configurable per asset type. Defaults for Mold:

- **Identity:** asset number, name, owner, tool number, customer/program, status (Active · In transfer · In maintenance · Refurbishing · Quarantined · Retired · Scrapped).
- **Design:** cavities (design vs active; individual cavities can be blocked), design cycle time, shot weight, material(s), mold dimensions and weight, clamp tonnage required, ejector pattern, hot runner (zones), cooling circuits, family/sister molds.
- **Life:** build date, toolmaker, warranty shots, shots between refurbishments, refurbishments allowed and done, expected end-of-life shots, capitalisation date and value, cost centre.
- **Live counters:** total shots, shots since last PM, shots since last refurbishment, % of life consumed.
- **Condition:** latest weighted condition score and trend; open defects.
- **Documents:** 2D/3D drawings, mold-trial report, PPAP/qualification records, certificates, photos (all versioned).

Admins add **custom fields** to any entity, with types text, number, date, picklist, user, file and formula. **Formula fields** derive values such as `parts per hour = active cavities × 3600 / cycle time`. [R]

---

## 4. Key workflows

### 4.1 Mold transfer lifecycle [N]

The headline gap in the reference. A transfer moves custody (and usually location) between sites or partner organisations with a full chain of custody.

```
Draft ─▶ Requested ─▶ Approved ─▶ Ready to ship ─▶ In transit ─▶ Received ─▶ Accepted ─▶ Closed
              │            │              │               │              │
              └─▶ Rejected └─▶ Cancelled  └─▶ Cancelled   └─▶ Exception  └─▶ Disputed ─▶ Resolved
```

| Step | Who | What happens |
| --- | --- | --- |
| Request | Tooling manager (or supplier, if allowed) | Pick asset(s), from → to site/partner, reason (production move, refurbishment, storage, end of program, return to owner), needed-by date |
| Approve | Approver per policy (e.g. owner org for any custody change; two-step for cross-border) | Approve or reject with comment |
| Ready to ship | Sending custodian | **Outbound handover:** shot count reading, condition checklist with photos, accessories/components list, packing and shipping documents |
| In transit | Sender | Carrier, tracking number, ETA; asset status becomes *In transit* and custody is held by "in transit" (configurable: sender keeps custody until receipt) |
| Received | Receiving custodian | **Inbound handover:** confirm identity (scan tag), shot count reading, condition checklist with photos |
| Accept / Dispute | Receiver | If the shot count or condition differs beyond a tolerance, it auto-flags *Disputed* and opens a discrepancy record; otherwise accepted |
| Close | System | Custody and location updated, history written, owner notified |

Rules:
- An asset can be in only one open transfer at a time.
- A **bulk transfer** moves many molds at once (a plant closure); each mold keeps its own handover records.
- Shot readings at handover feed **cycle reconciliation** (§4.3).
- Optional: a mold may be required to pass a PM/condition gate before shipping (policy per asset type).

### 4.2 Press compatibility [N]

Gap in the reference (no press entity). A press is an asset with: clamp tonnage, tie-bar spacing (H × V), platen size, min/max mold height (daylight), max opening stroke, shot size / screw diameter, ejector type and pattern, nozzle radius and orifice, locating ring diameter, hot-runner zone capacity, quick-mold-change system, and site.

- **Compatibility engine:** for a mold, list presses where every rule passes, with the reason for each failure. Example: "tonnage 450 t required, press has 400 t". The rules are configurable; defaults compare tonnage, tie-bar fit, mold height window, shot size %, locating ring, nozzle and hot-runner zones.
- **Approved press list:** a qualified mold–press pair (from a passed OQ/PQ) is recorded as *Approved*. Others are *Compatible (unqualified)* or *Incompatible*.
- Used by capacity planning (§4.7) and transfer planning ("which receiving site has a compatible, approved press?").

### 4.3 Cycle counting and reconciliation [R]+[N]

- **Sources:** manual entry (web/mobile with QR scan), handover readings, and CSV/XLSX import. **No sensor/IIoT integration** (D7); the public API accepts readings, so a sensor feed can be added later without data-model changes.
- Readings are monotonic per counter. A reading lower than the last one requires a reason (counter replaced or reset) and creates an offset so the lifetime total stays continuous.
- **Reconciliation [N]:** for each mold and period, compare manual readings, handover readings and production-reported parts ÷ active cavities (when production quantities are imported). Gaps beyond tolerance raise a reconciliation exception for review.
- **Production analytics [R]:** *deferred.* Run/idle/quality-time breakdowns need sensor data (out of scope per D7). The MVP reports shots per period, parts produced (shots × active cavities) and life consumed.

### 4.4 Maintenance [R]

- **Plans and triggers:** templates (checklist tasks, required parts/BOM, estimated hours, sign-off) attached to an asset or asset type. Triggers: every N shots, every N days, every N run-hours, a condition score below a threshold, or a meter outside bounds. Each trigger has a **lead time**: it warns at 90% of the interval and issues the work order at 100%.
- **Work orders:** types (preventive, corrective, refurbishment, inspection, modification, qualification). Configurable states, priority, root cause, assignee or team, scheduled and due dates, labour, parts consumed from stock, external quotes/POs, attachments, and full cost roll-up.
- **Checklists (PM sheets):** pass/fail/measurement tasks, photo-required tasks, signatures, pass %; a failed task can spawn a corrective work order.
- **Refurbishment:** a refurbishment work order resets "shots since refurbishment", increments refurbishments done, and can update the end-of-life forecast.
- **Quarantine:** an asset can be quarantined (blocked from transfer and production) until a work order clears it.
- **Compliance views:** overdue PMs, PM compliance %, MTTR and MTBF per asset and asset type.

### 4.5 Condition evaluation [R]

Weighted criteria per asset type (e.g. parting line, vents, cavities, cooling, ejectors, hot runner). Each scores 1–5 with a weight, photos and notes. Flow: Submitted → Approved / Rejected. The weighted score and trend appear on the passport; scores below a threshold trigger maintenance (§4.4). The next evaluation date is scheduled automatically.

### 4.6 Qualification (IQ/OQ/PQ) [R]

Stages IQ → OQ → PQ, each with status, owner, planned and actual dates, linked work orders, documents and approver. A pass at PQ on a given press records an **approved mold–press pair** (§4.2). Re-qualification is required after a transfer to a new site or after a major modification (policy, configurable).

### 4.7 Lifecycle planning: budget and capacity [R]

- **Budget:** per asset per year: planned PM, spare parts, refurbishments and replacement, generated from asset-type rules (e.g. refurbishment cost × expected refurbs this year; costs per cavity). Templates, mass-apply and an adjustment history with reasons. Actuals come from work-order costs, giving **budget vs actual**.
- **End-of-life forecast:** from shots per month (trailing average or demand-based), predict the refurbishment and end-of-life months for each mold.
- **Capacity plan:** monthly demand per product vs capacity of the molds that make it (active cavities, cycle time, OEE, approved presses, planned downtime for refurbishments). It flags months where demand exceeds capacity, and supports what-if molds and transfers.

### 4.8 Spare parts [R]

Parts with OEM/manufacturer numbers, compatible assets, stock per site and bin, min/max and reorder point, unit cost, and shelf life. The stock ledger records receipts, issues to work orders, transfers and adjustments. Purchase requests export to ERP; full purchasing is out of scope (§1).

### 4.9 Downtime [R]

Downtime events per asset with code/category, start and end, linked work order; MTBF and availability reporting. Events are entered manually or imported.

---

## 5. Modules and screens (Phase 3 MVP)

| Module | Key screens |
| --- | --- |
| **Home** | Role-based dashboard: my work, alerts (PM due, overdue transfers, disputes, life thresholds), KPIs |
| **Assets** | Search with saved filters and columns · mold passport (tabs: overview, specs, components & cavities, counters, maintenance, transfers & custody, condition, qualification, presses, documents, costs, history) · create/import · tag and QR printing · map of molds by site |
| **Presses** | Press registry · compatibility finder (mold → presses, press → molds) · approved pairs |
| **Transfers** | Transfer board by state · create (single or bulk) · handover forms (outbound/inbound, mobile-first) · disputes · chain-of-custody report |
| **Maintenance** | Work orders · PM checklists · plans and triggers · calendar · compliance reports |
| **Quality** | Condition evaluations · qualifications · defects |
| **Planning** | Budget by year · end-of-life forecast · capacity plan and what-if |
| **Inventory** | Parts · stock by site · ledger · reorder list |
| **Reports** | Standard reports (fleet status, custody by partner, life consumed, maintenance compliance, cost per mold, reconciliation exceptions) · CSV/XLSX export · scheduled email reports |
| **Supplier portal** | Separate, simplified UI: my molds, open transfers (confirm receipt/ship), record shots, PM checklists, upload documents |
| **Admin** | Users, roles and scopes · organisation, divisions, sites · partner organisations · asset types and custom fields · picklists · maintenance templates · transfer approval policies · integrations and API keys · audit log · import/export |

Mobile: responsive web for all technician and supplier flows in the MVP, with QR-scan to open an asset. A native/offline app is Phase 4 (D6).

---

## 6. Integrations [R]+[D]

| Integration | Direction | MVP? |
| --- | --- | --- |
| **Public REST API** (OpenAPI documented, API keys per org, scoped tokens) | In/out | Yes |
| IIoT counters (sensor ingestion, MQTT bridge, device ↔ asset mapping) | In | **No: not required (D7).** Possible later via the public API |
| **CSV/XLSX import/export** for assets, parts, readings and BOMs, with dry-run validation | In/out | Yes |
| **SSO**: SAML 2.0 / OIDC with group → role and group → site mapping | In | Yes |
| **Webhooks** (transfer state changed, work order closed, threshold crossed) | Out | Yes |
| ERP (SAP/Oracle/Dynamics) for asset master, cost centres, purchase requests | Bi-directional | Phase 4 |
| BI (Power BI/Tableau) via read-only views or export | Out | Phase 4 |

---

## 7. Notifications and alerts

In-app plus email, with per-user preferences and daily digest. Triggers: assigned work, PM due/overdue, life thresholds (e.g. 80% / 95% of warranty or end-of-life shots), transfer actions needed, handover disputes, reconciliation exceptions, shot readings overdue (no reading for N days on an active mold), evaluation due, qualification approvals. Escalation if an action is not taken within its SLA.

---

## 8. Reporting and KPIs

Fleet size and status by site and partner · molds in transit and average transit time · custody by partner · % life consumed distribution · molds approaching refurbishment or EOL (next 90 days) · PM compliance % · MTBF / MTTR · maintenance cost per mold and per 1,000 shots · budget vs actual · capacity utilisation and shortfall months · reconciliation exceptions open · data-quality score (passports missing required fields).

---

## 9. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Tenancy | Multi-tenant with strict row-level isolation; partner users can belong to multiple tenants' supplier networks |
| Security | SSO, MFA, passkeys; least-privilege roles; encryption in transit and at rest; signed URLs for documents; OWASP ASVS L2 |
| Audit | Immutable audit log, exportable; 7-year retention (configurable) |
| Scale | 100k assets and 5M meter readings per tenant; search < 1 s at p95 |
| Hosting & data residency | **India** (D8): production and backups in an Indian cloud region (e.g. AWS ap-south-1 Mumbai, with ap-south-2 Hyderabad for disaster recovery); tenant data and documents stay in India |
| Compliance | India's **Digital Personal Data Protection Act, 2023** (consent, purpose limitation, breach notification, data-principal rights); IT Act 2000 / CERT-In incident-reporting rules |
| Availability | 99.9% monthly; daily backups with point-in-time recovery |
| i18n | English at launch with translatable UI (Hindi and other languages later); metric units by default (imperial optional); default time zone IST with per-site time zones for overseas suppliers; default currency INR with multi-currency costs; Indian number formatting (lakh/crore) as a user preference |
| Accessibility | WCAG 2.1 AA |
| Data portability | Full tenant export (JSON + files) on request |

---

## 10. Proposed technical approach (for decision D4)

Next.js (TypeScript) web app and REST API · PostgreSQL (row-level security per tenant) · Prisma · object storage for documents · a background job queue for triggers, reports and email · OpenAPI-generated docs · hosted in an Indian region (D8). This matches the stack already used for the `Ezemes/Marketing` project, so patterns (auth, roles, admin console, audit) can be reused.

---

## 11. Phasing

| Phase | Contents |
| --- | --- |
| **3a — Foundation** (MVP core) | Tenancy, sites, partners, users/roles/scopes, audit · asset types and custom fields · mold passport · documents · manual meter readings · import/export |
| **3b — Operations** | Transfers with handovers and chain of custody · maintenance plans, triggers, work orders, checklists · supplier portal · notifications |
| **3c — Engineering & planning** | Presses and compatibility · condition evaluation · qualification · spare parts · budget · EOL forecast · capacity plan · reports |
| **3d — Connectivity** | Public API, webhooks, shot reconciliation, SSO |
| **4** | Native mobile/offline app (D6), ERP connectors, BI connectors, optional sensor/IIoT ingestion, AI assistance (natural-language search, anomaly detection) |

Each phase ends with acceptance tests (§12) passing, demo data, and user documentation.

---

## 12. Acceptance criteria (MVP, examples)

1. A tooling manager can create a Mold type with custom fields, import 1,000 molds from CSV with a dry-run report, and see every mold's passport.
2. A transfer from an OEM plant to a supplier goes through every state; the supplier user sees the mold only after acceptance; shot count and condition are captured at both handovers; a shot mismatch beyond tolerance creates a dispute.
3. A shot-based PM trigger creates a work order automatically when the counter crosses the threshold (warning first at the lead percentage).
4. For a mold needing 450 t, the compatibility finder excludes a 400 t press and shows why.
5. A technician scans a mold's QR code on a phone, enters a shot reading, and the passport's counters and trigger status update immediately; a reading lower than the last one is rejected unless a counter-reset reason is given.
6. Every custody change appears in the audit log and the chain-of-custody report.
7. A supplier user cannot see molds outside their custody or open any admin screen.

---

## 13. Decisions

| # | Decision | Outcome (2026-10-22) |
| --- | --- | --- |
| D1 | Product name | **Plant Metrics Mold Management** |
| D2 | MVP scope | **Mold-first**; general equipment uses the same asset model with fewer features |
| D3 | Custody during transit | **Sender stays responsible until the receiver confirms receipt** |
| D4 | Tech stack | **Next.js (TypeScript) + PostgreSQL**, as in §10 |
| D5 | Supplier portal | **Same app, restricted role and simplified navigation** |
| D6 | Mobile | **Responsive web with QR scanning** for the MVP; native app in Phase 4 |
| D7 | Sensors / IIoT | **Not required.** Shot counts come from manual entry, handovers and imports |
| D8 | Hosting | **India** (data residency in Indian region; DPDP Act compliance) |
| D9 | Authenticated reference analysis | Open, optional; the spec does not depend on it |
