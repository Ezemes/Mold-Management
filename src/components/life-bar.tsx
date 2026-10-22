export function LifeBar({ pct }: { pct: number }) {
  const color = pct >= 95 ? "bg-red-500" : pct >= 80 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="w-24" title={`${pct.toFixed(1)}% of end-of-life shots`}>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-200"><div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <p className="mt-0.5 text-[11px] tabular-nums text-ink-500">{pct.toFixed(1)}%</p>
    </div>
  );
}
