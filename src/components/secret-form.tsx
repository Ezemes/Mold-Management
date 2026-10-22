"use client";

import { useActionState, useState, type ReactNode } from "react";
import { btnClass } from "./ui";

type State = { secret?: string; label?: string; error?: string };

/** A form whose action returns a secret to show once (API token, webhook signing secret). */
export function SecretForm({ action, children, submit, note, className }: { action: (prev: State, fd: FormData) => Promise<State>; children: ReactNode; submit: string; note: string; className?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [copied, setCopied] = useState(false);
  return (
    <div>
      {state.secret ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm" role="status">
          <p className="font-medium text-emerald-900">{state.label}: copy this now</p>
          <p className="mt-1 text-emerald-800">{note}</p>
          <div className="mt-3 flex items-center gap-2">
            <code data-testid="one-time-secret" className="flex-1 break-all rounded bg-white px-2 py-1.5 font-mono text-xs text-ink-900 ring-1 ring-emerald-200">{state.secret}</code>
            <button type="button" className={btnClass("secondary", "sm")} onClick={() => { void navigator.clipboard?.writeText(state.secret!); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <a href="" className="mt-3 inline-block text-xs text-emerald-900 underline">Done</a>
        </div>
      ) : (
        <form action={formAction} className={className}>
          {state.error && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}
          {children}
          <button type="submit" disabled={pending} className={btnClass("primary")}>{pending ? "Working…" : submit}</button>
        </form>
      )}
    </div>
  );
}
