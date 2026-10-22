export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2 font-semibold text-ink-900">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-xs font-bold text-white">PM</span>
      {!compact && (
        <span className="leading-tight">
          Plant Metrics
          <span className="block text-[11px] font-medium text-ink-500">Mold Management</span>
        </span>
      )}
    </span>
  );
}
