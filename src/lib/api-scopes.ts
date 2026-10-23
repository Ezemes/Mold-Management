/** Scopes an API key can be granted. */
export const API_SCOPES = {
  "assets:read": "Read assets and passports",
  "readings:read": "Read shot readings",
  "readings:write": "Record shot readings",
  "transfers:read": "Read transfers",
  "work_orders:read": "Read work orders",
  "downtime:read": "Read downtime events",
  "downtime:write": "Record and end downtime events",
  "production:write": "Report production quantities (for shot reconciliation)",
  "reconciliation:read": "Read reconciliation exceptions",
  "sites:read": "Read sites and partners",
  "events:read": "Poll the event log",
} as const;
export type ApiScope = keyof typeof API_SCOPES;
