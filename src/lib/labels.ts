export function label<T extends Record<string, unknown>>(map: T, key: string | null | undefined): string {
  if (!key) return "—";
  const v = map[key as keyof T];
  if (v == null) return key;
  if (typeof v === "string") return v;
  return (v as { label?: string }).label ?? key;
}
