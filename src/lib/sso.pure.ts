/** Single sign-on rules: email domains and group → role/scope mapping. Pure functions, unit-tested. */

export type GroupMapping = { group: string; roleId: string; scopeType: "all" | "sites" | "divisions" | "partner"; scopeIds: string[]; partnerId: string | null };
export type MappingLine = { group: string; role: string; scopeType: GroupMapping["scopeType"]; refs: string[] };

export function emailDomain(email: string) {
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

export function parseDomains(src: string) {
  return [...new Set(src.split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean))];
}

export const validDomain = (d: string) => /^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/.test(d);

/**
 * One mapping per line: "IdP group | role | scope". Scope is "all" (default), "sites: PUN1, CHE1",
 * "divisions: AUTO" or "partner: Brightway Plastics". Lines are tried in order; the first match wins.
 */
export function parseMappingLines(src: string): { lines: MappingLine[]; errors: string[] } {
  const lines: MappingLine[] = [];
  const errors: string[] = [];
  src.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).forEach((l, i) => {
    const [group, role, scope = "all"] = l.split("|").map((x) => x.trim());
    if (!group || !role) { errors.push(`Line ${i + 1}: write “group | role | scope”.`); return; }
    const m = scope.match(/^(all|sites|divisions|partner)\s*(?::\s*(.*))?$/i);
    if (!m) { errors.push(`Line ${i + 1}: scope must be all, sites: …, divisions: … or partner: …`); return; }
    const scopeType = m[1].toLowerCase() as MappingLine["scopeType"];
    const refs = (m[2] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (scopeType !== "all" && !refs.length) { errors.push(`Line ${i + 1}: list the ${scopeType} after the colon.`); return; }
    if (scopeType === "partner" && refs.length > 1) { errors.push(`Line ${i + 1}: a supplier mapping names one partner.`); return; }
    lines.push({ group, role, scopeType, refs });
  });
  return { lines, errors };
}

/** The first mapping whose group the user belongs to (case-insensitive), else the default role with full scope, else null. */
export function resolveAccess(groups: string[], mappings: GroupMapping[], defaultRoleId: string | null): GroupMapping | null {
  const mine = new Set(groups.map((g) => g.toLowerCase()));
  const hit = mappings.find((m) => mine.has(m.group.toLowerCase()));
  if (hit) return hit;
  return defaultRoleId ? { group: "", roleId: defaultRoleId, scopeType: "all", scopeIds: [], partnerId: null } : null;
}

/** Groups arrive as an array, a single string or a comma-separated string depending on the IdP. */
export function groupsFrom(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") return value.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

/** Only same-site relative paths may be used after sign-in. */
export function safeReturnTo(p: string | null | undefined) {
  return p && p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\") ? p : "/dashboard";
}
