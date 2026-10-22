# Plant Metrics Mold Management

System of record for injection molds across your plants and supplier network: where each mold is, who has custody, how many shots it has run, its condition, and its full history. General plant equipment uses the same asset model.

**Status:** Phases 3a (Foundation), 3b (Operations), 3c (Engineering & planning) and 3d (Connectivity) are built and pass their acceptance suites. The approved specification is `docs/PHASE2_PRODUCT_SPEC.md`. Background research is in `research/`.

## What Phase 3a includes

- **Organisations, divisions and sites:** your own plants and warehouses, plus partner sites (molders, toolmakers, warehouses) with GSTIN, address and time zone.
- **Users, roles and scopes:**
  - 8 built-in roles (Org Admin, Tooling Manager, Planner, Quality Engineer, Technician, Viewer, Supplier Admin, Supplier User), plus custom roles with a permission matrix.
  - Each user's data is scoped to the whole organisation, selected sites, selected divisions, or (for suppliers) only the molds in their company's custody.
- **Audit log:** append-only, enforced by a database trigger, with before/after values and reasons, and CSV export.
- **Asset types and custom fields:** Mold, Press and General equipment by default. Features (components, cavities, products, shot counter, documents) can be switched on per type. Custom fields can be text, number, date, yes/no, picklist or **formula** (a safe arithmetic engine with no `eval`).
- **Mold passport:**
  - design, life and finance specs
  - ownership, custody, location and assignment kept as separate fields
  - components, cavities (block or unblock with a reason) and products made
  - versioned documents
  - history, status changes with reasons, and admin custody correction (logged)
- **Shot readings:**
  - Manual entry, or scan the mold's QR tag on a phone.
  - Readings can never go backwards; a counter reset needs a reason, and the lifetime total stays continuous across resets.
  - Readings must be in time order; future-dated readings and physically impossible jumps are rejected unless confirmed.
  - Overdue readings are flagged.
- **QR tags:** printable labels; scanning opens the mold's shot-counter page (after sign-in).
- **CSV import and export:**
  - Templates per asset type; the dry run reports problems by row number; applying re-checks against current data and imports in one transaction.
  - The asset export round-trips through Excel.
- **India defaults:** IST, INR, metric units, lakh/crore digit grouping (10,00,000), DD-MM-YYYY dates accepted, Indian states list, GSTIN validation. All of these are configurable per organisation.

## What Phase 3b adds

- **Transfers and handovers:**
  - Move one or more molds between your sites and partner sites: draft → requested → approved → shipped → received.
  - Approval policy is set per organisation: always, cross-company only (default), or never.
  - **Dispatch** records, per mold: the counter, an 8-point condition checklist, accessories and photos, plus carrier, vehicle, e-way bill, LR number and ETA.
  - **The sender stays responsible until the receiver confirms** (decision D3). On receipt, the receiver verifies the tag, records the counter, the checklist and photos, and custody passes over.
  - **Disputes** are raised automatically for shot gaps beyond the tolerance (default 50), a counter that goes backwards, new condition issues or missing accessories. The organisation resolves each one, optionally with a corrective work order.
  - The passport shows a **chain of custody**, and every step is audited.
- **Maintenance:**
  - **Templates** are reusable checklists written one task per line. Pass/fail checks, measured values with an allowed range (a value outside it fails automatically), photo tasks and optional tasks are supported.
  - **Plans** put a template on an asset (or every asset of a type) every N shots or every N days.
    - A plan warns at the lead percentage (default 90%).
    - When due, it raises **one** work order and never a second while one is open.
    - Any reading checks the plans: manual entry, CSV import or a handover count.
  - **Work orders:**
    - Types: preventive, corrective, refurbishment, inspection or modification.
    - Each can be assigned to a person or a partner company and carries a priority and due date.
    - Work moves through start → hold → resume, with the checklist, labour, parts, external cost and photos recorded along the way.
    - Completion requires a typed signature and every required check. It records the shot count, which restarts the plan.
    - Failed checks can raise a corrective follow-up automatically.
    - Completing a refurbishment updates the mold's refurbishment count and date.
  - **Quarantine:** quarantining a mold raises a release work order, and only completing it (with no failed checks) returns the mold to active.
  - **Compliance:** PM on-time %, overdue work, MTTR, MTBF and spend by type and by asset, over 30 days, 90 days or 12 months.
- **Supplier workflow:** suppliers dispatch and receive molds at their sites, and see and work on work orders for molds they hold or that are assigned to their company. Approvals, dispute resolution, plans and templates stay with the organisation.
- **Alerts:**
  - In-app alerts (with email) cover approvals, dispatches, receipts, disputes, assignments, maintenance due and due soon, 80%/95% of warranty and end-of-life shots, overdue readings, overdue work and late transfers.
  - Each alert is deduplicated, so repeats are suppressed.
  - The daily job runs triggers and overdue checks: `POST /api/cron/daily` with `Authorization: Bearer $CRON_SECRET`, called once a day from the host's scheduler.

## What Phase 3c adds

- **Presses and compatibility:**
  - Presses are assets with tonnage, tie-bar spacing, platen size, mold-height range, opening stroke, shot capacity, locating ring, nozzle radius, hot-runner zones and maximum mold weight. Molds gain height, opening, locating-ring and sprue-bush fields.
  - The **compatibility finder** checks a mold against every press, or a press against every mold.
    - Every failed rule gives its reason, e.g. "Clamp tonnage: Needs 450 t, press has 400 t". Missing data is reported as "not checked" and never fails.
    - Rules can be switched on or off, with a tonnage margin, shot-size window and locating-ring tolerance, under Settings.
  - **Approved pairs** come only from a passed PQ. They can be withdrawn with a reason.
  - Internal users can compare against every press in the organisation; suppliers see only their own.
- **Quality:**
  - **Condition evaluations** score weighted criteria per asset type from 1 to 5.
    - Scores of 2 or below need a note, and photos can be attached.
    - Evaluations are submitted, then approved or rejected.
    - An approved score updates the passport and schedules the next evaluation. If it falls below the type's threshold, a corrective work order is raised.
    - The daily job alerts when an evaluation is due.
  - **Qualification** runs IQ → OQ → PQ, with an owner, planned and actual dates, a result, a linked work order and a sign-off for each stage.
    - It can't start on a press that fails the compatibility rules.
    - Passing PQ approves the mold–press pair.
  - **Re-qualification** is flagged when custody moves to another site (a setting) and when a modification work order is completed; a modification also withdraws the approved pairs.
- **Spare parts:**
  - A parts catalogue (manufacturer numbers, linked assets, shelf life) with stock per site and bin, and min, reorder and max levels.
  - A ledger records receipts, issues to work orders, returns, moves between sites and counted adjustments (with a reason).
  - Work orders issue parts from the asset's site stock. A stock update can never go below zero, even with simultaneous issues. Removing an issued line returns the stock.
  - A **reorder list** exports as a purchase-request CSV for the ERP.
- **Planning:**
  - **Life forecast:** shots per month from the last 90 days of readings, giving the next refurbishment, warranty end and end-of-life dates for every mold.
  - **Capacity plan:** 12 months of demand per product (CSV import) against mold capacity (active cavities × 3600 ÷ cycle time × hours × OEE).
    - The forecast refurbishment month loses its downtime days, and a mold adds no capacity after its end of life. Family molds use the cavities per part.
    - Shortfall months are shown in red.
    - **What-if** (not saved): change OEE or hours, take molds out, or add a hypothetical mold from a chosen month.
  - **Budget:**
    - Set rules per asset type, then generate per asset and year in bulk: PM services from the plans and shot rate, parts per cavity, and refurbishment and replacement from the life forecast.
    - Manual adjustments need a reason, are audited and survive regeneration.
    - **Budget vs actual** draws on completed work-order costs.
- **Reports (CSV export):**
  - fleet status by site
  - custody by partner
  - life consumed
  - refurbishment and end of life in the next 90 days
  - maintenance cost per mold and per 1,000 shots
  - budget vs actual
  - transfer routes and average transit days
  - passport data quality with a fleet completeness score

## What Phase 3d adds

- **Public REST API** (`/api/v1`, reference at **/developers**, OpenAPI at `/api/v1/openapi.json`):
  - **Reading:** assets with passport summary, shot readings, transfers with handover counts, work orders with costs, sites, partners, reconciliation exceptions, and an event log for polling.
  - **Writing:**
    - **Shot readings:** batches of up to 1,000, accepted or rejected per item. Re-sending the same reading is reported as a duplicate, so retries are safe. Triggers, life alerts and reconciliation run afterwards.
    - **Production quantities:** used for shot reconciliation.
  - **API keys** are created under Admin → Integrations.
    - Each key has scopes, an optional restriction to certain sites, and an optional expiry. The token is shown once and only its SHA-256 hash is stored.
    - Keys are rate-limited to 600 requests per minute, and every write is audited with the key's name.
- **Webhooks:**
  - Events: `transfer.status_changed`, `work_order.closed`, `threshold.crossed` (80/95% of warranty or end-of-life shots; maintenance due) and `reconciliation.exception`.
  - Events go through an outbox and are deduplicated.
  - Every delivery is signed with HMAC-SHA256 (`X-PM-Signature: t=…,v1=…`) using a per-endpoint secret, which is encrypted at rest.
  - Failed deliveries are retried after 1 min, 5 min, 30 min, 2 h, 8 h and 24 h. An endpoint is switched off after 20 failures in a row.
  - Webhooks go to https URLs only and redirects aren't followed. The destination is checked again when connecting, so DNS changes can't redirect a delivery to an internal address.
  - The admin screen offers a test ping, the delivery history, a retry button and secret rotation.
- **Shot reconciliation:**
  - Production reports arrive from the API or a CSV import. Each is compared with the counter: parts ÷ cavities (per part for family molds) against counted shots.
  - The counter readings used are the ones closest to the period's start and end, within a set window.
  - A gap beyond the tolerance (default 5%, at least 200 shots) raises an exception, an alert and a webhook. Exceptions are accepted with an explanation or marked as corrected, and both are audited.
  - Reports still waiting for readings are rechecked whenever new readings arrive and by the daily job.
- **Single sign-on:**
  - **Protocols:** OpenID Connect (authorization code with PKCE; the ID token's signature, issuer, audience and nonce are verified) and SAML 2.0 (signed assertions, checked by `@node-saml/node-saml`).
  - **Signing in:** users enter their work email at **/login/sso** and are sent to their organisation's identity provider. Groups map to a role and a scope (all, sites, divisions or a supplier partner). The first matching group wins, and access is refreshed at every sign-in. Accounts can be created on first sign-in.
  - **Domain proof:** a domain must be verified with a DNS TXT record before anyone can sign in with it. This stops an organisation claiming addresses it doesn't own.
  - **Required SSO:** a connection can require SSO for its domains; org admins keep password sign-in as a break-glass.
  - **One-time state:** each sign-in is single-use and tied to the browser that started it, which protects against replay and login CSRF.
- **Security update:** Next.js went from 15.5.4 to 15.5.28, which fixes a critical remote-code-execution advisory.

## Calculated fields, health rating and guided inspections

Details, formulas and decisions are in [`docs/CALCULATIONS_AND_INSPECTIONS.md`](docs/CALCULATIONS_AND_INSPECTIONS.md).

- **Calculated fields** from the *Mold Calculated Fields* document, on every mold passport:
  - **Lifecycle:** Expected End of Life, Next Refurbishment, Refurbishment Priority, Remaining Life, Shots Since/Until Refurb, Refurbs Remaining, Calculated Replacement Cost and Cost Average Refurb.
  - **Capacity:** Daily, Weekly and Annual Output Capacity, Free Annual Capacity (pcs and %), Calculated Annual Volume, Calculated % Utilization, Production Days Required and Actual Cavitation %.
  - Each value says which inputs it still needs.
  - New inputs: process (department), annual volume and utilisation on the passport; the shift pattern and OEE on each site; cost per cavity in Settings.
  - The values feed custom formulas, the life forecast, the capacity plan, the API and a report.
- **Health rating:** 5 Excellent → 1 Unacceptable (plus N/A), with the *Mold Health Rating* descriptions. Approving an Unacceptable rating quarantines the mold; Poor ratings or reported issues raise a work order.
- **Inspection templates:** Injection (25 components) and Injection Blow (20), from your inspection spreadsheets, and Extrusion Blow (13 elements with YES/NO key points) from the *Workflow-based Inspection*. Each organisation can edit its own copies.
- **Guided assessment** (Quality → Start assessment):
  - On the bench or on the machine, with optional background video on the bench.
  - Captures live data, then one screen per element.
  - A NO answer needs a comment and a photo, and Poor or Unacceptable ratings need an explanation.
  - Ends with the templates' questions, then a review.
- **Reports:** *Inspection summary* (the templates' Summary sheet) and *Calculated fields*.

Not yet built: downtime events (§4.9); Phase 4 (native app, ERP/BI connectors, sensors, AI).

## Stack

Next.js 15 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 · PostgreSQL 14+ · Prisma 6 · `jose` sessions · bcrypt · PapaParse · `qrcode`.

## Run it locally

```bash
npm install
cp .env.example .env                 # set DATABASE_URL and a long random AUTH_SECRET
npx prisma migrate deploy            # creates tables + the audit-log immutability trigger
npm run db:seed                      # optional demo organisation (see below)
npm run dev                          # http://localhost:3000
```

Demo users (password `Demo@12345`), all in *Sharma Polymers Pvt Ltd*:

| Email | Role and scope |
|---|---|
| `admin@sharma.example` | Org Admin |
| `tooling@sharma.example` | Tooling Manager |
| `tech@sharma.example` | Technician: Pune Plant 1 and Pune Tool Store only |
| `supplier@brightway.example` | Supplier Admin: molds held by Brightway Plastics only |

To start without demo data, register at `/register`; you become the organisation's admin.

## Tests

```bash
npm test             # unit tests (49): formulas, shot counters, CSV import, transfers, maintenance, compatibility, quality, stock, planning
npm run test:e2e     # Phase 3a browser acceptance suite (31 checks) against a running app
npm run test:e2e:3b  # Phase 3b suite (36 checks): transfers, disputes, triggers, work orders, quarantine, supplier
npm run test:e2e:3c  # Phase 3c suite (34 checks): compatibility, qualification, evaluations, stock, planning, reports
npm run test:e2e:3d  # Phase 3d suite (49 checks): API, webhooks, reconciliation, OIDC and SAML sign-in
npm run test:e2e:inspection  # Calculated fields and guided inspections (35 checks)
```

The 3d suite runs its own mock OIDC and SAML identity providers (ports 4455/4456) and a webhook receiver (4466). Start the app for it with `APP_URL=http://localhost:3000 WEBHOOK_ALLOW_HTTP=1 WEBHOOK_ALLOW_PRIVATE=1 SSO_SKIP_DOMAIN_VERIFICATION=1`. These three settings are for tests only and must not be set in production.

Reset the test database before each suite with `e2e/reset-db.sh <DATABASE_URL>` (drops, migrates and seeds it), then restart the app so it opens fresh connections. The 3b suite also needs `CRON_SECRET` set to the same value as the app.

The e2e suite needs a **fresh** seeded database, `DATABASE_URL` pointing at it, `psql` on `PATH`, and Chromium (`CHROMIUM_PATH`, default `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; `BASE_URL` defaults to `http://localhost:3000`). It covers spec acceptance criteria 1 (custom field plus 1,000-mold import with dry run), 5 (QR → reading, backwards rejected without reset) and 7 (supplier sees only their custody and cannot reach admin), plus site scoping, documents, formulas and audit immutability. The 3b suite covers criteria 2 (transfer with handover counts, dispute and resolution), 3 (shot trigger warns, then raises one work order) and 6 (every custody change audited and shown on the passport). The 3c suite covers criterion 4 (a 450 t mold is excluded from a 400 t press, with the reason).

## Deployment notes (India, spec D8)

- Host the app, PostgreSQL and backups in an Indian region (e.g. AWS ap-south-1 Mumbai, ap-south-2 Hyderabad for disaster recovery).
- `STORAGE_DIR` stores uploaded documents on local disk. In production, replace `src/lib/storage.ts` with object storage in the same Indian region.
- `src/lib/mail.ts` logs emails to the server console. Plug in a provider before launch; verification codes and reset links show on screen only in development.
- Set `APP_URL` to the public URL; it is printed into QR tags and emailed links.
- Set `CRON_SECRET` (16+ characters) and schedule a daily `POST /api/cron/daily` (e.g. 06:00 IST). Running it more than once a day is harmless.
- Also schedule `POST /api/cron/webhooks` (same bearer token) every minute; it retries failed webhook deliveries.
- Serve the app over https. SSO state cookies are `Secure; SameSite=None` because SAML posts back cross-site.
- The API rate limit is per app process; behind several instances, add a limit at the load balancer too.
- Secrets at rest (webhook secrets, OIDC client secrets) are encrypted with a key derived from `DATA_KEY`, or from `AUTH_SECRET` if `DATA_KEY` isn't set. Rotating that key makes the stored secrets unreadable, so re-enter them afterwards.

## Code map

```
prisma/schema.prisma          Data model; migration adds the audit-log trigger
src/lib/auth.ts               Sessions, org context, permission checks, data scoping (assetScope/siteScope)
src/lib/permissions.ts        Modules, actions, built-in roles
src/lib/audit.ts              Audit writer (stores only changed fields)
src/lib/assets.ts             Standard fields, features, formula variables
src/lib/asset-values.ts       Field parsing/validation shared by forms and CSV import
src/lib/formula.ts            Safe arithmetic engine for formula fields
src/lib/meters*.ts            Shot-counter rules (pure logic + persistence)
src/lib/importer.ts           CSV import planning (pure, unit-tested)
src/lib/transfers*.ts         Transfer state machine, approval policy, handover reconciliation
src/lib/maintenance*.ts       Task syntax, checklist rules, plan state, compliance metrics; trigger engine
src/lib/notify.ts             Alert recipients by permission and scope, deduped notifications + email
src/lib/daily.ts              Daily job: triggers, overdue readings, overdue work, late transfers, evaluations due
src/lib/compat*.ts            Press compatibility rules engine (pure) and finder queries
src/lib/quality*.ts           Weighted condition scores, IQ/OQ/PQ stage rules, re-qualification
src/lib/inventory*.ts         Stock rules (pure) and the atomic stock move
src/lib/planning*.ts          Shot rate, life forecast, budget rules, capacity (pure) and fleet queries
src/lib/reports.ts            Standard reports (shared by the pages and CSV export)
src/lib/calc.pure.ts          Calculated fields (lifecycle and capacity) with missing-input diagnostics
src/lib/inspection*.ts        Health rating, inspection templates, assessment rules
src/lib/api*.ts               API keys, auth, scopes, rate limit, paging; JSON shapes
src/lib/openapi.ts            OpenAPI document (also renders /developers)
src/lib/ingest.ts             Readings and production ingestion shared by the API and CSV
src/lib/webhooks*.ts          Event outbox, signing, retries, private-address guard
src/lib/reconcile*.ts         Shot reconciliation (pure) and exception handling
src/lib/sso*.ts               OIDC and SAML sign-in, domain verification, group mapping
src/lib/crypto.ts             AES-256-GCM for secrets at rest, hashing, tokens
src/app/(auth)/               Register, verify email, login, reset password, accept invite
src/app/(app)/assets/         Asset list, passport, create/edit, QR tag
src/app/(app)/admin/          Sites, partners, asset types, users, roles, audit, settings
src/app/(app)/import-export/  CSV import (dry run → apply) and exports
src/app/(app)/transfers/      Transfer list, request, approve, dispatch, receive, disputes
src/app/(app)/maintenance/    Work orders, plans, templates, compliance report
src/app/(app)/notifications/  Alerts
src/app/(app)/presses/        Press registry, compatibility finder, approved pairs
src/app/(app)/quality/        Guided assessments, evaluations, qualifications, inspection templates
src/app/(app)/inventory/      Parts, stock by site, ledger, reorder list
src/app/(app)/planning/       Life forecast, capacity plan, budget
src/app/(app)/reports/        Standard reports
src/app/(app)/reconciliation/ Exceptions, production reports, CSV import
src/app/(app)/admin/integrations/  API keys, webhooks, single sign-on
src/app/api/v1/               Public REST API
src/app/api/sso/              SSO start, OIDC callback, SAML ACS and metadata
src/app/developers/           Public API and webhook reference
src/app/api/cron/             Daily job and webhook retry endpoints
e2e/                          Browser acceptance suite
```
