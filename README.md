# Plant Metrics Mold Management

System of record for injection molds across your plants and supplier network: where each mold is, who has custody, how many shots it has run, its condition, and its full history. General plant equipment uses the same asset model.

**Status:** Phase 3a (Foundation) and Phase 3b (Transfers, Maintenance, Supplier workflow) are built and pass their acceptance suites. The approved specification is `docs/PHASE2_PRODUCT_SPEC.md`. Background research is in `research/`.

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

Not yet built, planned per the spec: presses and compatibility (3c), planning (3c), API and webhooks (3d).

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
npm test             # unit tests: formulas, shot-counter rules, field parsing, time zones, CSV import planning
npm run test:e2e     # Phase 3a browser acceptance suite (31 checks) against a running app
npm run test:e2e:3b  # Phase 3b suite (36 checks): transfers, disputes, triggers, work orders, quarantine, supplier
```

Reset the test database before each suite with `e2e/reset-db.sh <DATABASE_URL>` (drops, migrates and seeds it), then restart the app so it opens fresh connections. The 3b suite also needs `CRON_SECRET` set to the same value as the app.

The e2e suite needs a **fresh** seeded database, `DATABASE_URL` pointing at it, `psql` on `PATH`, and Chromium (`CHROMIUM_PATH`, default `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; `BASE_URL` defaults to `http://localhost:3000`). It covers spec acceptance criteria 1 (custom field plus 1,000-mold import with dry run), 5 (QR → reading, backwards rejected without reset) and 7 (supplier sees only their custody and cannot reach admin), plus site scoping, documents, formulas and audit immutability. The 3b suite covers criteria 2 (transfer with handover counts, dispute and resolution), 3 (shot trigger warns, then raises one work order) and 6 (every custody change audited and shown on the passport).

## Deployment notes (India, spec D8)

- Host the app, PostgreSQL and backups in an Indian region (e.g. AWS ap-south-1 Mumbai, ap-south-2 Hyderabad for disaster recovery).
- `STORAGE_DIR` stores uploaded documents on local disk. In production, replace `src/lib/storage.ts` with object storage in the same Indian region.
- `src/lib/mail.ts` logs emails to the server console. Plug in a provider before launch; verification codes and reset links show on screen only in development.
- Set `APP_URL` to the public URL; it is printed into QR tags and emailed links.
- Set `CRON_SECRET` (16+ characters) and schedule a daily `POST /api/cron/daily` (e.g. 06:00 IST). Running it more than once a day is harmless.

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
src/lib/daily.ts              Daily job: triggers, overdue readings, overdue work, late transfers
src/app/(auth)/               Register, verify email, login, reset password, accept invite
src/app/(app)/assets/         Asset list, passport, create/edit, QR tag
src/app/(app)/admin/          Sites, partners, asset types, users, roles, audit, settings
src/app/(app)/import-export/  CSV import (dry run → apply) and exports
src/app/(app)/transfers/      Transfer list, request, approve, dispatch, receive, disputes
src/app/(app)/maintenance/    Work orders, plans, templates, compliance report
src/app/(app)/notifications/  Alerts
src/app/api/cron/daily/       Daily job endpoint
e2e/                          Browser acceptance suite
```
