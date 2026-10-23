import { API_SCOPES } from "./api-scopes";
import { EVENT_TYPES } from "./webhooks.pure";

const page = (item: string) => ({ type: "object", properties: { data: { type: "array", items: { $ref: `#/components/schemas/${item}` } }, next_cursor: { type: "string", nullable: true, description: "Pass as `cursor` to get the next page; null on the last page." } } });
const one = (item: string) => ({ type: "object", properties: { data: { $ref: `#/components/schemas/${item}` } } });
const json = (schema: object) => ({ content: { "application/json": { schema } } });
const q = (name: string, description: string, schema: object = { type: "string" }) => ({ name, in: "query", required: false, description, schema });
const pathParam = (name: string, description: string) => ({ name, in: "path", required: true, description, schema: { type: "string" } });
const paging = [q("limit", "Items per page, 1–200 (default 50).", { type: "integer" }), q("cursor", "`next_cursor` from the previous page.")];
const errors = { 400: { $ref: "#/components/responses/Error" }, 401: { $ref: "#/components/responses/Error" }, 403: { $ref: "#/components/responses/Error" }, 429: { $ref: "#/components/responses/Error" } };
const op = (summary: string, scope: string, extra: object) => ({ summary, description: `Requires scope \`${scope}\`.`, security: [{ apiKey: [] }], "x-scope": scope, ...extra });

/** OpenAPI 3.0 description of /api/v1 (served at /api/v1/openapi.json and rendered at /developers). */
export function openApiSpec(baseUrl: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "Plant Metrics Mold Management API",
      version: "1.0.0",
      description:
        "Read assets, transfers and work orders; record shot readings and downtime; report production for shot reconciliation; poll events. " +
        "Authenticate with an organisation API key: `Authorization: Bearer pmk_…`. Keys are created by an admin under Admin → Integrations and can be limited to scopes and sites. " +
        "Limit: 600 requests per minute per key. Errors return `{ \"error\": { \"code\", \"message\", \"details\" } }`. Dates are ISO 8601 (UTC).",
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: `API key. Scopes: ${Object.entries(API_SCOPES).map(([k, v]) => `\`${k}\` (${v})`).join(", ")}.` } },
      responses: { Error: { description: "Error", ...json({ $ref: "#/components/schemas/Error" }) } },
      schemas: {
        Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, details: {} } } } },
        Asset: {
          type: "object",
          properties: {
            id: { type: "string" }, number: { type: "string", example: "M-0001" }, name: { type: "string" },
            type: { type: "object", properties: { key: { type: "string" }, name: { type: "string" }, kind: { type: "string", enum: ["mold", "press", "equipment"] } } },
            status: { type: "string", enum: ["active", "in_transfer", "in_maintenance", "refurbishing", "quarantined", "retired", "scrapped"] },
            site: { type: "object", properties: { code: { type: "string" }, name: { type: "string" } } }, location_detail: { type: "string" },
            custodian: { type: "object", properties: { partner_id: { type: "string", nullable: true }, name: { type: "string" } } },
            owner: { type: "object", properties: { partner_id: { type: "string", nullable: true }, name: { type: "string" } } },
            design: { type: "object", additionalProperties: true }, life: { type: "object", properties: { lifetime_shots: { type: "integer", nullable: true }, last_reading_at: { type: "string", nullable: true }, life_used_pct: { type: "number", nullable: true } }, additionalProperties: true },
            condition_score: { type: "number", nullable: true }, requalification_required: { type: "string", nullable: true }, custom_fields: { type: "object", additionalProperties: true }, updated_at: { type: "string", format: "date-time" },
          },
        },
        Reading: { type: "object", properties: { id: { type: "string" }, read_at: { type: "string", format: "date-time" }, value: { type: "integer" }, lifetime_shots: { type: "integer" }, delta: { type: "integer" }, source: { type: "string", enum: ["manual", "import", "handover", "api"] }, is_reset: { type: "boolean" }, reset_reason: { type: "string", nullable: true }, note: { type: "string", nullable: true } } },
        ReadingInput: {
          type: "object", required: ["asset", "value"],
          properties: {
            asset: { type: "string", description: "Asset number" }, value: { type: "integer", description: "Raw counter value as shown on the mold" },
            read_at: { type: "string", format: "date-time", description: "Defaults to now" }, is_reset: { type: "boolean", description: "The counter was reset or replaced; needs reset_reason" },
            reset_reason: { type: "string" }, note: { type: "string" }, confirm_high: { type: "boolean", description: "Accept a reading above what the cycle time makes plausible" },
          },
        },
        ProductionInput: {
          type: "object", required: ["asset", "period_start", "period_end", "parts"],
          properties: { asset: { type: "string" }, period_start: { type: "string", format: "date-time" }, period_end: { type: "string", format: "date-time" }, parts: { type: "integer" }, part_number: { type: "string", description: "For family molds: cavities per part are taken from the passport" }, reference: { type: "string" } },
        },
        ItemResult: { type: "object", properties: { index: { type: "integer" }, asset: { type: "string", nullable: true }, status: { type: "string", enum: ["created", "duplicate", "error"] }, code: { type: "string" }, message: { type: "string" } }, additionalProperties: true },
        Transfer: { type: "object", properties: { id: { type: "string" }, number: { type: "string", example: "T-0001" }, status: { type: "string", enum: ["draft", "requested", "approved", "in_transit", "disputed", "completed", "rejected", "cancelled"] }, from: { type: "object" }, to: { type: "object" }, items: { type: "array", items: { type: "object" } }, updated_at: { type: "string" } }, additionalProperties: true },
        Downtime: { type: "object", properties: { id: { type: "string" }, number: { type: "string", example: "DT-00001" }, asset: { type: "string" }, press: { type: "string", nullable: true }, code: { type: "string", example: "COOL" }, reason: { type: "string" }, category: { type: "string", enum: ["failure", "planned", "external"] }, started_at: { type: "string" }, ended_at: { type: "string", nullable: true }, open: { type: "boolean" }, duration_hours: { type: "number" }, description: { type: "string", nullable: true }, work_order: { type: "string", nullable: true }, source: { type: "string" } } },
        DowntimeInput: { type: "object", required: ["asset", "code", "started_at"], properties: { asset: { type: "string", example: "M-0001" }, code: { type: "string", example: "COOL", description: "A reason code from Downtime → Reason codes" }, started_at: { type: "string", format: "date-time" }, ended_at: { type: "string", format: "date-time", nullable: true, description: "Leave out while the mold is still down" }, press: { type: "string" }, work_order: { type: "string" }, description: { type: "string" } } },
        WorkOrder: { type: "object", properties: { id: { type: "string" }, number: { type: "string", example: "WO-00001" }, asset: { type: "string" }, type: { type: "string" }, status: { type: "string", enum: ["open", "in_progress", "on_hold", "completed", "cancelled"] }, cost: { type: "object" }, updated_at: { type: "string" } }, additionalProperties: true },
        ReconciliationException: { type: "object", properties: { id: { type: "string" }, asset: { type: "string" }, status: { type: "string", enum: ["open", "accepted", "resolved"] }, expected_shots: { type: "integer" }, recorded_shots: { type: "integer" }, gap: { type: "integer" }, gap_pct: { type: "number" } }, additionalProperties: true },
        Site: { type: "object", properties: { id: { type: "string" }, code: { type: "string" }, name: { type: "string" }, kind: { type: "string" }, company: { type: "object", nullable: true } }, additionalProperties: true },
        Partner: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, kind: { type: "string" }, gstin: { type: "string" } }, additionalProperties: true },
        Event: { type: "object", properties: { id: { type: "string" }, type: { type: "string", enum: Object.keys(EVENT_TYPES) }, created_at: { type: "string" }, data: { type: "object", additionalProperties: true } } },
      },
    },
    paths: {
      "/assets": { get: op("List assets", "assets:read", { parameters: [q("type", "Asset type key or kind (mold, press, equipment)"), q("site", "Site code"), q("status", "Asset status"), q("updated_since", "Only assets changed since (ISO 8601)"), ...paging], responses: { 200: { description: "Assets", ...json(page("Asset")) }, ...errors } }) },
      "/assets/{number}": { get: op("Get an asset (passport summary)", "assets:read", { parameters: [pathParam("number", "Asset number")], responses: { 200: { description: "Asset", ...json(one("Asset")) }, 404: { $ref: "#/components/responses/Error" }, ...errors } }) },
      "/assets/{number}/readings": { get: op("List an asset's shot readings (newest first)", "readings:read", { parameters: [pathParam("number", "Asset number"), q("since", "Only readings taken since (ISO 8601)"), ...paging], responses: { 200: { description: "Readings", ...json(page("Reading")) }, ...errors } }) },
      "/readings": {
        post: op("Record shot readings", "readings:write", {
          description: "Requires scope `readings:write`. Up to 1,000 readings per request, each accepted or rejected on its own. Readings can't go backwards unless `is_reset` with a reason. Re-sending an identical reading (same asset, time and value) returns `duplicate`, so retries are safe. Maintenance triggers, life alerts and reconciliation run afterwards.",
          requestBody: { required: true, ...json({ type: "object", properties: { readings: { type: "array", items: { $ref: "#/components/schemas/ReadingInput" } } } }) },
          responses: { 200: { description: "Per-item results", ...json({ type: "object", properties: { created: { type: "integer" }, duplicates: { type: "integer" }, failed: { type: "integer" }, results: { type: "array", items: { $ref: "#/components/schemas/ItemResult" } } } }) }, ...errors },
        }),
      },
      "/production": {
        post: op("Report production quantities", "production:write", {
          description: "Requires scope `production:write`. Parts made by a mold over a period (≤ 92 days). Once counter readings exist near the period's start and end, the counter shots are compared with parts ÷ cavities; a gap beyond the organisation's tolerance raises a reconciliation exception (and the `reconciliation.exception` webhook). Re-sending the same asset, period and part number updates the quantity.",
          requestBody: { required: true, ...json({ type: "object", properties: { reports: { type: "array", items: { $ref: "#/components/schemas/ProductionInput" } } } }) },
          responses: { 200: { description: "Per-item results with reconciliation status (pending, matched, exception, unverifiable)", ...json({ type: "object", properties: { accepted: { type: "integer" }, failed: { type: "integer" }, results: { type: "array", items: { $ref: "#/components/schemas/ItemResult" } } } }) }, ...errors },
        }),
      },
      "/reconciliation/exceptions": { get: op("List reconciliation exceptions", "reconciliation:read", { parameters: [q("status", "open, accepted or resolved"), ...paging], responses: { 200: { description: "Exceptions", ...json(page("ReconciliationException")) }, ...errors } }) },
      "/transfers": { get: op("List transfers", "transfers:read", { parameters: [q("status", "Transfer status"), q("updated_since", "ISO 8601"), ...paging], responses: { 200: { description: "Transfers", ...json(page("Transfer")) }, ...errors } }) },
      "/transfers/{number}": { get: op("Get a transfer with its handover counts", "transfers:read", { parameters: [pathParam("number", "Transfer number")], responses: { 200: { description: "Transfer", ...json(one("Transfer")) }, ...errors } }) },
      "/work-orders": { get: op("List work orders", "work_orders:read", { parameters: [q("status", "Work order status"), q("type", "preventive, corrective, refurbishment, inspection, modification"), q("asset", "Asset number"), q("updated_since", "ISO 8601"), ...paging], responses: { 200: { description: "Work orders", ...json(page("WorkOrder")) }, ...errors } }) },
      "/work-orders/{number}": { get: op("Get a work order with costs", "work_orders:read", { parameters: [pathParam("number", "Work order number")], responses: { 200: { description: "Work order", ...json(one("WorkOrder")) }, ...errors } }) },
      "/downtime": {
        get: op("List downtime events", "downtime:read", { parameters: [q("asset", "Asset number"), q("category", "failure, planned or external"), q("open", "true = still down, false = ended"), q("updated_since", "ISO 8601"), ...paging], responses: { 200: { description: "Downtime events", ...json(page("Downtime")) }, ...errors } }),
        post: op("Record downtime", "downtime:write", { requestBody: { required: true, ...json({ $ref: "#/components/schemas/DowntimeInput" }) }, responses: { 201: { description: "Recorded", ...json(one("Downtime")) }, 409: { $ref: "#/components/responses/Error" }, ...errors } }),
      },
      "/downtime/{number}": {
        get: op("Get a downtime event", "downtime:read", { parameters: [pathParam("number", "Event number, e.g. DT-00001")], responses: { 200: { description: "Downtime event", ...json(one("Downtime")) }, ...errors } }),
        patch: op("End a downtime event", "downtime:write", { parameters: [pathParam("number", "Event number")], requestBody: { required: false, ...json({ type: "object", properties: { ended_at: { type: "string", format: "date-time", description: "Defaults to now" } } }) }, responses: { 200: { description: "Ended", ...json(one("Downtime")) }, 409: { $ref: "#/components/responses/Error" }, ...errors } }),
      },
      "/sites": { get: op("List sites", "sites:read", { responses: { 200: { description: "Sites", ...json({ type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Site" } } } }) }, ...errors } }) },
      "/partners": { get: op("List partner companies", "sites:read", { responses: { 200: { description: "Partners", ...json({ type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Partner" } } } }) }, ...errors } }) },
      "/events": { get: op("Poll the event log (oldest first)", "events:read", { description: "Requires scope `events:read`. The same events webhooks deliver, kept for 90 days; page forward with `cursor`. Keys limited to sites receive no events.", parameters: [q("type", "Event type"), ...paging], responses: { 200: { description: "Events", ...json(page("Event")) }, ...errors } }) },
    },
    "x-webhooks": {
      description: "Webhooks POST `{ id, type, created_at, data }` as JSON. Verify `X-PM-Signature: t=<unix>,v1=<hex>` where v1 = HMAC-SHA256(secret, `${t}.${raw body}`), and reject timestamps older than 5 minutes. Respond 2xx within 10 s; failures are retried after 1 min, 5 min, 30 min, 2 h, 8 h and 24 h. Use `X-PM-Event-Id` to ignore repeats.",
      events: EVENT_TYPES,
    },
  };
}
