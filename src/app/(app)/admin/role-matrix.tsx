import { ACTIONS, MODULES, type Permissions } from "@/lib/permissions";

export function RoleMatrix({ perms, disabled }: { perms: Permissions; disabled?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-ink-500">
          <tr><th className="px-3 py-2 text-left font-medium">Module</th>{ACTIONS.map((a) => <th key={a} className="px-3 py-2 font-medium">{a}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {Object.entries(MODULES).map(([m, label]) => (
            <tr key={m}>
              <td className="px-3 py-2">{label}</td>
              {ACTIONS.map((a) => (
                <td key={a} className="px-3 py-2 text-center">
                  <input type="checkbox" name={`perm.${m}.${a}`} defaultChecked={!!perms[m as keyof Permissions]?.includes(a)} disabled={disabled} aria-label={`${label}: ${a}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
